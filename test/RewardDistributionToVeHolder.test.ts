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
const {  DEFAULT_ADMIN_ROLE, NATIVE_ETH_ADDRESS } = require(`../helpers/constants`)
const { AddressZero } = constants
const addressObj = require(`../helpers/address/local.json`);
const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const GWEI_ADDRESS = addressObj["GWEI"]["token_address"];
const VEGWEI_ADDRESS = addressObj["VEGWEI"]["token_address"];
const schedules = createScheduleScenarios();
const targetSchedule = schedules[6];
const fourYearsInSec = 3600 * 24 * 365 * 4;
const STAKING_START_TIME = 1719446400

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

  const ethgasPoolDeploy = await deployments.get('EthgasPoolFoundation');
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
    ethgasPoolAddr: ethgasPoolDeploy.address
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

const advanceOneWeek = async () => {
  return advanceTimeAndBlock(3600 * 24 * 7)
}

const advanceFourWeeks = async () => {
  return advanceTimeAndBlock(3600 * 24 * 28)
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
  let feeDistributor: Contract
  let ethgasPoolAddr: string

  const fundEthgasToken = async (targetAddress: string, amount: BigNumber) => {
    await ethgasToken.connect(deployerSigner).transfer(targetAddress, amount)
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
        tokenLockBalance: await ethgasToken.balanceOf(tokenLock.address),
        tokenLockStakedBalance: await veToken.balanceOf(tokenLock.address),
        contractRevokedAmount: await tokenLock.revokedAmount(),
        feeDistributorBalance: await ethgasToken.balanceOf(feeDistributor.address),
        adminBalance: await ethgasToken.balanceOf(contractAdminSigner.address),
        vestedAmount: await tokenLock.vestedAmount(),
        revokedAmount: await tokenLock.revokedAmount(),
        releasableAmount: await tokenLock.releasableAmount(),
        releasedAmount: await tokenLock.releasedAmount(),
        user2Balance: await ethgasToken.balanceOf(userSigners[2].address),
        user2StakedBalance: await veToken.balanceOf(userSigners[2].address),
        user3Balance: await ethgasToken.balanceOf(userSigners[3].address),
        user3StakedBalance: await veToken.balanceOf(userSigners[3].address),
        totalStaked: await veToken.totalSupply(),
      }
    }

    before(async function () {
      const staticArgs = {
        beneficiary: beneficiary1Signer.address,
      }
      targetSchedule[0]["revocable"] = false
      targetSchedule[1]["revocable"] = false
      initArgs = { ...staticArgs, ...targetSchedule[0] }
      const fixture = setupTest(initArgs)
      ;({ ethgasToken, tokenLock, ethgasPoolAddr } = await fixture());
      veToken = await ethers.getContractAt("IVotingEscrow", VEGWEI_ADDRESS)
      feeDistributor = await ethers.getContractAt("IFeeDistributor", addressObj["feeDistributor"]["address"])
      await fundEthgasToken(tokenLock.address, await tokenLock.managedAmount())
      await fundEthgasToken(userSigners[2].address, parseTokenAmount("25000", "GWEI"))
      await fundEthgasToken(userSigners[3].address, parseTokenAmount("25000", "GWEI"))
      await fundEthgasToken(contractAdminSigner.address, parseTokenAmount("0.1", "GWEI"))
      const whitelistedAddresses = Array(30).fill(ethers.constants.AddressZero);
      whitelistedAddresses[0] = tokenLock.address;
      whitelistedAddresses[1] = addressObj["feeDistributor"]["address"];
      const isWhitelists = Array(30).fill(true)
      await veToken.connect(contractAdminSigner).whitelist_contracts(whitelistedAddresses, isWhitelists);
      await feeDistributor.connect(contractAdminSigner).toggle_allow_checkpoint_token();
    })

    describe('Staking', function () {

      it('ve staker claim staking reward', async function () {
        console.log('\t>> Scenario ', targetSchedule[1])
        let latestTimestamp = await getLatestBlockTimestamp()
        let tx = tokenLock.connect(beneficiary1Signer).stake(
          parseTokenAmount("1", "GWEI"),
          latestTimestamp + fourYearsInSec
        )
        await expect(tx).revertedWith("cannot stake before the earliestStakingTime");
        console.log("\ncannot stake before the earliestStakingTime")
        await moveToTime(tokenLock, BigNumber.from(STAKING_START_TIME - 86400 * 5), 60)
        console.log("\nvesting user stake locked amount for 2 years & user2 stake 4 years")
        let newState = await getState();
        const releasableAmountPerPeriod = newState.releasableAmount;
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await tokenLock.connect(beneficiary1Signer).acceptLock();
        tx = tokenLock.connect(beneficiary1Signer).stake(
          newState.tokenLockBalance.sub(releasableAmountPerPeriod).sub(parseTokenAmount("1.1", "GWEI")),
          latestTimestamp + fourYearsInSec / 2
        )
        await expect(tx).to.emit(tokenLock, "TokensStaked").withArgs(
          tokenLock.address, newState.tokenLockBalance.sub(releasableAmountPerPeriod).sub(parseTokenAmount("1.1", "GWEI")), latestTimestamp + fourYearsInSec / 2
        )
        tx = tokenLock.connect(beneficiary1Signer).stake(
          parseTokenAmount("1", "GWEI"),
          1000 // no use here
        )
        await expect(tx).to.emit(tokenLock, "TokensStaked").withArgs(
          tokenLock.address, parseTokenAmount("1", "GWEI"), 0
        )
        await ethgasToken.connect(userSigners[2]).approve(veToken.address, newState.user2Balance);
        await ethgasToken.connect(contractAdminSigner).approve(veToken.address, parseTokenAmount("0.1", "GWEI"));
        let failedTx = veToken.connect(contractAdminSigner).create_lock_for(userSigners[2].address, parseTokenAmount("0.1", "GWEI"), latestTimestamp + fourYearsInSec)
        await expect(failedTx).reverted
        failedTx = veToken.connect(contractAdminSigner).increase_amount_for(userSigners[2].address, parseTokenAmount("0.1", "GWEI"))
        await expect(failedTx).reverted
        console.log("unauthorized address cannot create_lock_for() or increase_amount_for() another address")
        await veToken.connect(userSigners[2]).create_lock(newState.user2Balance, latestTimestamp + fourYearsInSec)
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadvance to one week after STAKING_START_TIME, fund 1000 Gwei token in the mid of the week & claim reward")
        await moveToTime(tokenLock, BigNumber.from(STAKING_START_TIME), 60)
        advanceTimeAndBlock(3600 * 24 * 5)
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("1000", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24 * 2)
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))

        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        newState = await getState();
        console.log("tokens_per_week at STAKING_START_TIME", formatTokenAmount(await feeDistributor.tokens_per_week(STAKING_START_TIME), "ETH"));
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        console.log("\nadvance half a week & user3 stake")
        await moveToTime(tokenLock, BigNumber.from(latestTimestamp + 3600 * 24 * 3.5), 60)
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await ethgasToken.connect(userSigners[3]).approve(veToken.address, newState.user3Balance);
        await veToken.connect(userSigners[3]).create_lock(newState.user3Balance, latestTimestamp + fourYearsInSec)
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        console.log("\nfund 2000 Gwei token & advance half a week & claim reward")
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("2000", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        await moveToTime(tokenLock, BigNumber.from(latestTimestamp + 3600 * 24 * 3.5), 60);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        newState = await getState();
        console.log("tokens_per_week at STAKING_START_TIME", formatTokenAmount(await feeDistributor.tokens_per_week(STAKING_START_TIME), "ETH"));
        console.log("tokens_per_week at one week after STAKING_START_TIME", formatTokenAmount(await feeDistributor.tokens_per_week(STAKING_START_TIME + 3600 * 24 * 7), "ETH"));
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadvance one more week, fund 4000 Gwei token in the mid of the week & claim reward")
        advanceTimeAndBlock(3600 * 24 * 5)
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("4000", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24 * 2)
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        tx = tokenLock.connect(beneficiary1Signer).claimStakingReward();
        await expect(tx).revertedWith("cannot claim before unlockStartTime");
        newState = await getState();
        const firstWeeklyReward = await feeDistributor.tokens_per_week(STAKING_START_TIME)
        const secondWeeklyReward = await feeDistributor.tokens_per_week(STAKING_START_TIME + 3600 * 24 * 7)
        const thirdWeeklyReward = await feeDistributor.tokens_per_week(STAKING_START_TIME + 3600 * 24 * 14)
        expect(firstWeeklyReward).eq(parseTokenAmount("1000", "GWEI"))
        expect(secondWeeklyReward).eq(parseTokenAmount("2000", "GWEI"))
        expect(thirdWeeklyReward).eq(parseTokenAmount("4000", "GWEI"))
        expect(newState.feeDistributorBalance).gt(parseTokenAmount("3972", "GWEI"))
        expect(newState.feeDistributorBalance).lt(parseTokenAmount("3973", "GWEI"))
        expect(newState.user2Balance).gt(parseTokenAmount("2009", "GWEI"))
        expect(newState.user2Balance).lt(parseTokenAmount("2010", "GWEI"))
        expect(newState.user3Balance).gt(parseTokenAmount("1018", "GWEI"))
        expect(newState.user3Balance).lt(parseTokenAmount("1019", "GWEI"))
        console.log("tokens_per_week at STAKING_START_TIME", formatTokenAmount(firstWeeklyReward, "GWEI"));
        console.log("tokens_per_week at one week after STAKING_START_TIME", formatTokenAmount(secondWeeklyReward, "GWEI"));
        console.log("tokens_per_week at 2 weeks after STAKING_START_TIME", formatTokenAmount(thirdWeeklyReward, "GWEI"));
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        latestTimestamp = await getLatestBlockTimestamp()
        let numberOfWeeksToUnlockStart = Math.floor((targetSchedule[0]["unlockStartTime"] - latestTimestamp) / (3600 * 24 * 7));
        console.log(`\ncheckpoint total supply every 20 weeks, advance ${numberOfWeeksToUnlockStart} weeks to unlockStartTime`)
        for (let i = 0; i <= numberOfWeeksToUnlockStart; i ++) {
          await advanceOneWeek();
          if (i % 20 === 0) {
            latestTimestamp = await getLatestBlockTimestamp()
            await fundEthgasToken(feeDistributor.address, parseTokenAmount("0.1", "GWEI"))
            await feeDistributor.connect(userSigners[3]).checkpoint_token();
            await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
            console.log(new Date(latestTimestamp * 1000), "fund 0.1 Gwei token & checkpoint")
          }
        }
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nclaim reward")
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        tx = tokenLock.connect(beneficiary1Signer).claimStakingReward();
        await expect(tx).to.emit(tokenLock, "RewardClaimed")
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        let claimAddresses = Array(20).fill(ethers.constants.AddressZero);
        claimAddresses[0] = userSigners[2].address;
        claimAddresses[1] = userSigners[2].address;
        claimAddresses[2] = userSigners[2].address;
        claimAddresses[3] = userSigners[2].address;
        await feeDistributor.connect(userSigners[2]).claim_many(claimAddresses);
        claimAddresses = Array(20).fill(ethers.constants.AddressZero);
        claimAddresses[0] = userSigners[3].address;
        claimAddresses[1] = userSigners[3].address;
        claimAddresses[2] = userSigners[3].address;
        claimAddresses[3] = userSigners[3].address;
        await feeDistributor.connect(userSigners[3]).claim_many(claimAddresses);
        newState = await getState();
        expect(newState.beneficiaryBalance).gt(parseTokenAmount("3972", "GWEI"))
        expect(newState.beneficiaryBalance).lt(parseTokenAmount("3973", "GWEI"))
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        console.log("\ntransfer away all user Gwei token to make comparison easier")
        await ethgasToken.connect(beneficiary1Signer).transfer(NATIVE_ETH_ADDRESS, await ethgasToken.balanceOf(beneficiary1Signer.address))
        await ethgasToken.connect(userSigners[2]).transfer(NATIVE_ETH_ADDRESS, await ethgasToken.balanceOf(userSigners[2].address))
        await ethgasToken.connect(userSigners[3]).transfer(NATIVE_ETH_ADDRESS, await ethgasToken.balanceOf(userSigners[3].address))
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("releasedAmount:", formatTokenAmount(newState.releasedAmount, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        console.log("\nvesting user cannot stake for expired lock")
        tx = tokenLock.connect(beneficiary1Signer).stake(
          parseTokenAmount("0.1", "GWEI"),
          latestTimestamp + fourYearsInSec / 2
        )
        await expect(tx).revertedWith("CannotStakeForExpiredLock")
        console.log("vesting user withdraw then stake 3500 for 4 years")
        await tokenLock.connect(beneficiary1Signer).unstake()
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        newState = await getState();
        // no staking reward can be claimed
        expect(newState.beneficiaryBalance).eq(0)
        tx = tokenLock.connect(beneficiary1Signer).stake(
          parseTokenAmount("3500", "GWEI"),
          latestTimestamp + fourYearsInSec
        )
        await expect(tx).to.emit(tokenLock, "TokensStaked").withArgs(
          tokenLock.address, parseTokenAmount("3500", "GWEI"), latestTimestamp + fourYearsInSec
        )
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadvance 2 more weeks, fund 3000 Gwei token & claim reward")
        await advanceOneWeek();
        advanceTimeAndBlock(3600 * 24 * 5);
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("3000", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24 * 2);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("releasedAmount:", formatTokenAmount(newState.releasedAmount, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        console.log("\nadvance 3 more weeks, fund 0.1 Gwei token weekly, release vested token")
        for (let i = 0; i < 3; i++) {
          advanceTimeAndBlock(3600 * 24 * 5);
          await fundEthgasToken(feeDistributor.address, parseTokenAmount("0.1", "GWEI"))
          await feeDistributor.connect(userSigners[3]).checkpoint_token();
          await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
          advanceTimeAndBlock(3600 * 24 * 2);
          await feeDistributor.connect(userSigners[3]).checkpoint_token();
        }
        await tokenLock.connect(beneficiary1Signer).release(false, 0);
        newState = await getState();
        expect(newState.releasedAmount).eq(await tokenLock.unlockAmountPerPeriod())
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("releasedAmount:", formatTokenAmount(newState.releasedAmount, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))


        console.log("\nadvance 1 more week, users & admin transfer out gwei token, fund 9982 Gwei token in the mid of the week & claim reward")
        console.log("9982 is also total veGwei balance which make the comparison easier")
        advanceTimeAndBlock(3600 * 24 * 6);
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("9982", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await ethgasToken.connect(beneficiary1Signer).transfer(NATIVE_ETH_ADDRESS, newState.beneficiaryBalance)
        await ethgasToken.connect(userSigners[2]).transfer(NATIVE_ETH_ADDRESS, newState.user2Balance)
        await ethgasToken.connect(userSigners[3]).transfer(NATIVE_ETH_ADDRESS, newState.user3Balance)
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        // cannot claim on behalf of other
        tx = feeDistributor.connect(userSigners[3]).claim(userSigners[2].address)
        await expect(tx).reverted
        await tokenLock.connect(beneficiary1Signer).claimStakingReward();
        newState = await getState();
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"), "(approximately equal to their veGwei balance below)")
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("beneficiary veGwei balance:", formatTokenAmount(newState.beneficiaryStakedBalance, "GWEI"))
        console.log("releasedAmount:", formatTokenAmount(newState.releasedAmount, "GWEI"))
        console.log("TokenLock Gwei balance:", formatTokenAmount(newState.tokenLockBalance, "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"), "(approximately equal to their veGwei balance below)")
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"), "(approximately equal to their veGwei balance below)")
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadvance 1 more week, users & admin transfer out gwei token, fund 9725 Gwei token in the mid of the week & claim reward")
        advanceTimeAndBlock(3600 * 24 * 6);
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("9725", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await ethgasToken.connect(beneficiary1Signer).transfer(NATIVE_ETH_ADDRESS, newState.beneficiaryBalance)
        await ethgasToken.connect(userSigners[2]).transfer(NATIVE_ETH_ADDRESS, newState.user2Balance)
        await ethgasToken.connect(userSigners[3]).transfer(NATIVE_ETH_ADDRESS, newState.user3Balance)
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        await tokenLock.connect(contractAdminSigner).claimStakingReward();
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        await tokenLock.connect(contractAdminSigner).claimStakingReward();
        newState = await getState();          
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nuser3 extend lock to year end 2028, advance 2 more weeks, user & admin transfer out gwei token, fund Gwei token & claim reward")
        await veToken.connect(userSigners[3]).increase_unlock_time(latestTimestamp + fourYearsInSec / 4)
        await advanceOneWeek();
        await advanceOneWeek();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("0.1", "GWEI"))
        await feeDistributor.connect(userSigners[1]).checkpoint_token();
        await feeDistributor.connect(userSigners[1]).checkpoint_total_supply();
        await feeDistributor.connect(userSigners[2]).claim(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        await tokenLock.connect(contractAdminSigner).claimStakingReward();

        console.log("\nadvance 1 more week, user & admin transfer out gwei token, fund 11832 Gwei token in the mid of the week")
        advanceTimeAndBlock(3600 * 24 * 6);
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("11832", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        await ethgasToken.connect(beneficiary1Signer).transfer(NATIVE_ETH_ADDRESS, newState.beneficiaryBalance)
        await ethgasToken.connect(userSigners[2]).transfer(NATIVE_ETH_ADDRESS, newState.user2Balance)
        await ethgasToken.connect(userSigners[3]).transfer(NATIVE_ETH_ADDRESS, newState.user3Balance)
        newState = await getState();
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("EthgasPool Gwei balance:", formatTokenAmount(await ethgasToken.balanceOf(ethgasPoolAddr), "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))
        console.log(">>> claim reward <<<")
        await feeDistributor.connect(userSigners[2]).claim_and_stake(userSigners[2].address)
        await feeDistributor.connect(userSigners[3]).claim(userSigners[3].address)
        await tokenLock.connect(contractAdminSigner).claimStakingReward();
        newState = await getState();
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("beneficiary Gwei balance:", formatTokenAmount(newState.beneficiaryBalance, "GWEI"))
        console.log("TokenLock veGwei balance:", formatTokenAmount(newState.tokenLockStakedBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"), "(claim and stake)")
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("EthgasPool Gwei balance:", formatTokenAmount(await ethgasToken.balanceOf(ethgasPoolAddr), "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadvance 1 more week, user3 transfer out gwei token, fund 12117 Gwei token in the mid of the week")
        advanceTimeAndBlock(3600 * 24 * 6);
        await fundEthgasToken(feeDistributor.address, parseTokenAmount("12117", "GWEI"))
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await feeDistributor.connect(userSigners[3]).checkpoint_total_supply();
        advanceTimeAndBlock(3600 * 24);
        await feeDistributor.connect(userSigners[3]).checkpoint_token();
        await ethgasToken.connect(userSigners[3]).transfer(NATIVE_ETH_ADDRESS, newState.user3Balance)
        latestTimestamp = await getLatestBlockTimestamp()
        console.log(new Date(latestTimestamp * 1000))
        newState = await getState();
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"))
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"))
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))
        console.log(">>> claim reward <<<")
        const userAddresses = Array(20).fill(ethers.constants.AddressZero);
        userAddresses[0] = userSigners[2].address;
        userAddresses[1] = userSigners[3].address;
        const unlockTimes = Array(20).fill(0);
        failedTx = feeDistributor.connect(deployerSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        failedTx = feeDistributor.connect(contractAdminSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        console.log("unauthorized address cannot call claim_many_and_stake() for others")
        await feeDistributor.connect(contractAdminSigner).whitelist_claimer(deployerSigner.address, true);
        failedTx = feeDistributor.connect(deployerSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        failedTx = feeDistributor.connect(contractAdminSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        console.log("authorized address cannot call claim_many_and_stake() for those who haven't enabled auto claim")
        await feeDistributor.connect(userSigners[2]).set_auto_claim(true);
        await feeDistributor.connect(userSigners[3]).set_auto_claim(true);
        failedTx = feeDistributor.connect(contractAdminSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        await feeDistributor.connect(deployerSigner).claim_many_and_stake(userAddresses, unlockTimes);
        console.log("suucessfully claim and stake on behalf of user2 & user3")
        await feeDistributor.connect(userSigners[2]).set_auto_claim(false);
        await feeDistributor.connect(userSigners[3]).set_auto_claim(false);
        failedTx = feeDistributor.connect(deployerSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        failedTx = feeDistributor.connect(contractAdminSigner).claim_many_and_stake(userAddresses, unlockTimes);
        await expect(failedTx).reverted;
        console.log("authorized address cannot call claim_many_and_stake() for those who disabled auto claim")
        newState = await getState();
        expect(newState.user2StakedBalance).gt(parseTokenAmount("3060", "GWEI"))
        expect(newState.user2StakedBalance).lt(parseTokenAmount("3061", "GWEI"))
        expect(newState.user3StakedBalance).gt(parseTokenAmount("7137", "GWEI"))
        expect(newState.user3StakedBalance).lt(parseTokenAmount("7138", "GWEI"))
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        console.log("user2 Gwei balance:", formatTokenAmount(newState.user2Balance, "GWEI"))
        console.log("user2 veGwei balance:", formatTokenAmount(newState.user2StakedBalance, "GWEI"), "(auto claim and stake)")
        console.log("user3 Gwei balance:", formatTokenAmount(newState.user3Balance, "GWEI"))
        console.log("user3 veGwei balance:", formatTokenAmount(newState.user3StakedBalance, "GWEI"), "(auto claim and stake)")
        console.log("total veGwei:", formatTokenAmount(newState.totalStaked, "GWEI"))

        console.log("\nadmin kill the distributor contract")
        await feeDistributor.connect(contractAdminSigner).kill_me();
        newState = await getState();
        console.log("feeDistributor Gwei balance:", formatTokenAmount(newState.feeDistributorBalance, "GWEI"))
        const gweiBalanceForEthgasPool = await ethgasToken.balanceOf(ethgasPoolAddr)
        console.log("EthgasPool Gwei balance:", formatTokenAmount(gweiBalanceForEthgasPool, "GWEI"), "(it should get the remaining balance of feeDistributor)")
        expect(gweiBalanceForEthgasPool).gt(parseTokenAmount("3402", "GWEI"))
        expect(gweiBalanceForEthgasPool).lt(parseTokenAmount("3403", "GWEI"))
      })
    })
  })
})