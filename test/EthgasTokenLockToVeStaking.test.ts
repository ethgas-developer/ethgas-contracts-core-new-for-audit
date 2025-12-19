import { expect } from 'chai'
import { constants, BigNumber, Contract } from 'ethers'
import hre from "hardhat"
import { ethers, deployments, getNamedAccounts } from 'hardhat'
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import 'hardhat-deploy'

import { EthgasToken, EthgasTokenLock } from "../typechain";
const { parseTokenAmount, formatTokenAmount } = require(`../helpers/utils`)
import { createScheduleScenarios } from './lock_config'
import { advanceTimeAndBlock, getAccounts, getContract, toBN, toEthgasToken, Account } from './lock_network'
const {  DEFAULT_ADMIN_ROLE } = require(`../helpers/constants`)
const { AddressZero } = constants
const addressObj = require(`../helpers/address/local.json`);
const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const GWEI_ADDRESS = addressObj["GWEI"]["token_address"];
const VEGWEI_ADDRESS = addressObj["VEGWEI"]["token_address"];
const schedules = createScheduleScenarios();
const targetSchedule = schedules[6];
const fourYearsInSec =  3600 * 24 * 365 * 4;

// Fixture
const setupTest = (params: {
  beneficiary: string,
  managedAmount: BigNumber,
  unlockPeriods: number,
  unlockStartTime: number,
  unlockEndTime: number,
  initialUnlockAmount: BigNumber,
  revocable: boolean,
  vestingPeriods: number,
  vestingCliffTime: number,
  vestingEndTime: number,
  vestingCliffAmount: BigNumber
}) => deployments.createFixture(async ({ deployments }) => {
  const { deployerFoundation } = await getNamedAccounts();
  const { deploy } = deployments

  // need to run EthgasPool to renounce admin role of deployer
  await deployments.fixture(['EthgasSetupFoundation', 'EthgasPoolFoundation', 'EthgasToken']);
  const aclManagerDeploy = await deployments.get('ACLManagerFoundation');
  const ethgasToken = await ethers.getContractAt("contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20", GWEI_ADDRESS);
  let tokenLockDeploy = await deploy("EthgasTokenLock", {
      from: deployerFoundation,
      log: true,
      args: [
        aclManagerDeploy.address,
        params.beneficiary,
        ethgasToken.address,
        params.managedAmount, 
        {
          unlockPeriods: params.unlockPeriods,
          unlockStartTime: params.unlockStartTime,
          unlockEndTime: params.unlockEndTime,
          initialUnlockAmount: params.initialUnlockAmount
        },
        params.revocable,
        {
          vestingPeriods: params.vestingPeriods, 
          vestingCliffTime: params.vestingCliffTime, 
          vestingEndTime: params.vestingEndTime,
          vestingCliffAmount: params.vestingCliffAmount
        },
        VEGWEI_ADDRESS,
        addressObj["snapshotDelegateRegistry"]["address"],
        addressObj["feeDistributor"]["address"],
        configObj["earliestStakingTimeForTokenLock"]
      ]
  });


  let tokenLock = await ethers.getContractAt(tokenLockDeploy.abi, tokenLockDeploy.address);

  return {
    ethgasToken: ethgasToken as EthgasToken,
    tokenLock: tokenLock as EthgasTokenLock,
    aclManagerAddress: aclManagerDeploy.address
  }
})

// -- Time utils --

async function getLatestBlockTimestamp() {
  const latestBlock = await ethers.provider.getBlock("latest");
  const timestamp = latestBlock.timestamp;
  return timestamp
}

const advanceUnlockPeriods = async (tokenLock: EthgasTokenLock, n = 1) => {
  const unlockPeriodDuration = await tokenLock.unlockPeriodDuration()
  return advanceTimeAndBlock(unlockPeriodDuration.mul(n).toNumber()) // advance N period
}

const moveToTime = async (tokenLock: EthgasTokenLock, target: BigNumber, buffer: number) => {
  const ts = await tokenLock.currentTime()
  const delta = target.sub(ts).add(buffer)
  return advanceTimeAndBlock(delta.toNumber())
}

const advanceToUnlockStart = async (tokenLock: EthgasTokenLock) => moveToTime(tokenLock, await tokenLock.unlockStartTime(), 60)

// -- Tests --

describe('EthgasTokenLock to Voting Escrow', () => {
  let beneficiary1Signer: SignerWithAddress
  let beneficiary2Signer: SignerWithAddress
  let deployerSigner: SignerWithAddress;
  let contractAdminSigner: SignerWithAddress;
  let userSigners: SignerWithAddress[];
  let initArgs: any;

  let ethgasToken: EthgasToken
  let veToken: Contract;
  let tokenLock: EthgasTokenLock
  let aclManagerAddress: string

  const fundContract = async (contract: EthgasTokenLock) => {
    const managedAmount = await contract.managedAmount()
    await ethgasToken.connect(deployerSigner).transfer(contract.address, managedAmount)
  }

  before(async function () {
    const { deployerFoundation, contractAdminFoundation, user0, user1, user2, user3 } = await getNamedAccounts();
    deployerSigner = await ethers.getSigner(deployerFoundation);
    contractAdminSigner = await ethers.getSigner(contractAdminFoundation);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];
    beneficiary1Signer = userSigners[0]
    beneficiary2Signer = userSigners[1]
  })

  describe('> Test scenario', function () {
    async function getState() {
      const beneficiaryAddress = await tokenLock.beneficiary()
      return {
        beneficiaryBalance: await ethgasToken.balanceOf(beneficiaryAddress),
        beneficiaryStakedBalance: await veToken.balanceOf(beneficiaryAddress),
        contractBalance: await ethgasToken.balanceOf(tokenLock.address),
        contractStakedBalance: await veToken.balanceOf(tokenLock.address),
        adminBalance: await ethgasToken.balanceOf(contractAdminSigner.address),
        vestedAmount: await tokenLock.vestedAmount(),
        revokedAmount: await tokenLock.revokedAmount(),
        releasableAmount: await tokenLock.releasableAmount(),
        releasedAmount: await tokenLock.releasedAmount(),
      }
    }

    before(async function () {
      const staticArgs = {
        beneficiary: beneficiary1Signer.address,
      }
      targetSchedule[0]["vestingCliffTime"] = new Date('2026-07-01T09:00:00Z').getTime() / 1000
      targetSchedule[0]["vestingEndTime"] = new Date('2028-01-01T08:59:59Z').getTime() / 1000
      targetSchedule[1]["vestingCliffTime"] = '2026-07-01T09:00:00Z'
      targetSchedule[1]["vestingEndTime"] = '2028-01-01T08:59:59Z'
      initArgs = { ...staticArgs, ...targetSchedule[0] }
      const fixture = setupTest(initArgs)
      ;({ ethgasToken, tokenLock, aclManagerAddress } = await fixture());
      veToken = await ethers.getContractAt("IVotingEscrow", VEGWEI_ADDRESS)
      await fundContract(tokenLock)
      const whitelistedAddresses = Array(30).fill(ethers.constants.AddressZero);
      whitelistedAddresses[0] = tokenLock.address;
      const isWhitelists = Array(30).fill(true)
      await veToken.connect(contractAdminSigner).whitelist_contracts(whitelistedAddresses, isWhitelists);
    })

    describe('Staking', function () {

      it('release and stake to Voting Escrow contract', async function () {
        console.log('\t>> Scenario ', targetSchedule[1])
        console.log("\nadvance to unlock start and 1 month later")
        await advanceToUnlockStart(tokenLock);
        await advanceUnlockPeriods(tokenLock);
        await advanceTimeAndBlock(86400 * 2.5) // vesting period is slightly longer than unlock period
        const releasableAmountPerPeriod = await tokenLock.unlockAmountPerPeriod();
        let latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        let newState = await getState();
        expect(newState.vestedAmount).to.eq(releasableAmountPerPeriod.mul(17));
        console.log("vestedAmount: ", formatTokenAmount(newState.vestedAmount, "GWEI"));
        console.log("revokedAmount: ", formatTokenAmount(newState.revokedAmount, "GWEI"));
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))
        console.log("admin Gwei balance:", formatTokenAmount(newState.adminBalance, "GWEI"))
        const managedAmount = parseTokenAmount(targetSchedule[1]["managedAmount"], "GWEI");
        console.log("\nrelease and stake on behalf beneficiary for 4 years")
        await tokenLock.connect(beneficiary1Signer).acceptLock();
        let tx = await tokenLock.connect(beneficiary1Signer).release(
          true,
          latestTimestamp + fourYearsInSec
        )
        await expect(tx).to.emit(tokenLock, "TokensStaked").withArgs(
          beneficiary1Signer.address, releasableAmountPerPeriod, latestTimestamp + fourYearsInSec
        )
        let failedTx = tokenLock.connect(beneficiary1Signer).stake(
          releasableAmountPerPeriod.mul(17),
          latestTimestamp + fourYearsInSec / 2
        )
        await expect(failedTx).reverted
        console.log("cannot stake on behalf of the vesting contract before fully vested or revoked")
        
        tx = await tokenLock.connect(contractAdminSigner).revoke();
        await expect(tx).to.emit(tokenLock, "TokensRevoked").withArgs(
          beneficiary1Signer.address, releasableAmountPerPeriod.add(10) // 10 wei of dust amount
        )
        tx = tokenLock.connect(beneficiary1Signer).stake(
          managedAmount.sub(releasableAmountPerPeriod.mul(6)).sub(10),
          latestTimestamp + fourYearsInSec / 2
        )
        await expect(tx).to.emit(tokenLock, "TokensStaked").withArgs(
          tokenLock.address, managedAmount.sub(releasableAmountPerPeriod.mul(6)).sub(10), latestTimestamp + fourYearsInSec / 2
        )
        console.log("can stake on behalf of the vesting contract for 2 years after revoked")
        newState = await getState();
        expect(newState.releasableAmount).to.eq(0)
        expect(newState.releasedAmount).to.eq(releasableAmountPerPeriod)
        expect(newState.adminBalance).to.eq(newState.revokedAmount)
        expect(newState.revokedAmount).to.eq(releasableAmountPerPeriod.add(10))
        expect(newState.beneficiaryBalance).to.equal(0);
        console.log("vestedAmount: ", formatTokenAmount(newState.vestedAmount, "GWEI"));
        console.log("revokedAmount: ", formatTokenAmount(newState.revokedAmount, "GWEI"));
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"), "(~ releasedAmount)")
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))
        console.log("admin Gwei balance:", formatTokenAmount(newState.adminBalance, "GWEI"))

        console.log("\nadvance to 1 month later and release")
        await advanceUnlockPeriods(tokenLock);
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        tx = await tokenLock.connect(beneficiary1Signer).release(
          false,
          0
        )
        await expect(tx).to.emit(tokenLock, "TokensReleased").withArgs(
          beneficiary1Signer.address, releasableAmountPerPeriod
        )
        newState = await getState();
        expect(newState.releasableAmount).to.eq(0)
        expect(newState.releasedAmount).to.eq(releasableAmountPerPeriod.mul(2))
        expect(newState.beneficiaryBalance).to.equal(releasableAmountPerPeriod);
        expect(newState.contractBalance).to.equal(releasableAmountPerPeriod.mul(3));
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))

        console.log("\nadvance to 3 month later and release")
        await advanceUnlockPeriods(tokenLock);
        await advanceUnlockPeriods(tokenLock);
        await advanceUnlockPeriods(tokenLock);
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        tx = await tokenLock.connect(beneficiary1Signer).release(
          false,
          0
        )
        await expect(tx).to.emit(tokenLock, "TokensReleased").withArgs(
          beneficiary1Signer.address, releasableAmountPerPeriod.mul(3)
        )
        newState = await getState();
        expect(newState.releasedAmount).to.eq(releasableAmountPerPeriod.mul(5))
        expect(newState.beneficiaryBalance).to.eq(releasableAmountPerPeriod.mul(4))
        expect(newState.contractBalance).to.eq(0)
        console.log("revokedAmount: ", formatTokenAmount(newState.revokedAmount, "GWEI"));
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))

        console.log("\nadvance to 9 more months later")
        await advanceUnlockPeriods(tokenLock, 9);
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        console.log("failed to unstake on behalf of vesting contract as the ve lock hasn't expire")
        await expect(tokenLock.connect(deployerSigner).unstake()).to.be.revertedWith("The lock didn't expire");
        newState = await getState();
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))
        console.log("Admin Gwei balance:", formatTokenAmount(newState.adminBalance, "GWEI"))

        console.log("\nadvance to 11 more months later")
        await advanceUnlockPeriods(tokenLock, 11);
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await expect(veToken.connect(beneficiary1Signer).withdraw()).to.be.revertedWith("The lock didn't expire");
        console.log("failed to unstake on behalf of beneficiary as the ve lock hasn't expire")
        tx = await tokenLock.connect(deployerSigner).unstake();
        await expect(tx).to.emit(tokenLock, "TokensUnstaked");
        tx = await tokenLock.connect(beneficiary1Signer).release(
          false,
          0
        )
        console.log("succeed to unstake on behalf of the vesting contract and release it")
        await expect(tx).to.emit(tokenLock, "TokensReleased").withArgs(
          beneficiary1Signer.address, managedAmount.sub(releasableAmountPerPeriod.mul(6)).sub(10)
        )
        newState = await getState();
        expect(newState.releasableAmount).to.eq(0)
        expect(newState.releasedAmount.add(10)).to.eq(managedAmount.sub(releasableAmountPerPeriod))
        expect(newState.beneficiaryBalance).to.equal(releasableAmountPerPeriod.mul(16));
        expect(newState.contractStakedBalance).to.equal(0);
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))
        console.log("Admin Gwei balance:", formatTokenAmount(newState.adminBalance, "GWEI"))
        tx = await tokenLock.connect(beneficiary1Signer).setAutoClaim(
          true
        )
        await expect(tx).to.emit(tokenLock, "SetAutoClaim").withArgs(
          true
        )
        console.log("succeed to enable auto claim")
        tx = await tokenLock.connect(beneficiary1Signer).setAutoClaim(
          false
        )
        await expect(tx).to.emit(tokenLock, "SetAutoClaim").withArgs(
          false
        )
        console.log("succeed to disable auto claim")

        console.log("\nadvance to 2 more years later")
        latestTimestamp = await getLatestBlockTimestamp()
        await moveToTime(tokenLock, ethers.BigNumber.from(latestTimestamp + fourYearsInSec / 2), 60);
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await veToken.connect(beneficiary1Signer).withdraw();
        console.log("succeed to unstake")
        newState = await getState();
        expect(newState.beneficiaryStakedBalance).to.eq(0);
        expect(newState.beneficiaryBalance.add(10)).to.eq(managedAmount.sub(releasableAmountPerPeriod));
        expect(newState.beneficiaryBalance).to.eq(newState.releasedAmount);
        console.log("releasedAmount: ", formatTokenAmount(newState.releasedAmount, "GWEI"));
        console.log("Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("Contract Gwei balance:", formatTokenAmount(newState.contractBalance, "GWEI"))
        console.log("Contract veGwei balance:", formatTokenAmount(newState.contractStakedBalance, "GWEI"))
        console.log("Admin Gwei balance:", formatTokenAmount(newState.adminBalance, "GWEI"))
      })
    })
  })
})