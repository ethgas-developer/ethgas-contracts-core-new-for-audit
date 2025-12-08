import { expect } from 'chai'
import { constants, BigNumber } from 'ethers'
import hre from "hardhat"
import { ethers, deployments, getNamedAccounts } from 'hardhat'
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import 'hardhat-deploy'

import { EthgasToken, EthgasTokenLock } from "../typechain";

import { createScheduleScenarios } from './lock_config'
import { advanceTimeAndBlock, getAccounts, getContract, toBN, toEthgasToken, Account } from './lock_network'
const {  DEFAULT_ADMIN_ROLE } = require(`../helpers/constants`)
const addressObj = require(`../helpers/address/mainnet.json`);
const { AddressZero } = constants

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
  const { deployer, contractAdmin, user0, user1, user2, user3 } = await getNamedAccounts();
  const { deploy } = deployments

  // need to run EthgasPool to renounce admin role of deployer
  await deployments.fixture(['EthgasSetup', 'EthgasPool', 'EthgasToken']);
  const aclManagerDeploy = await deployments.get('ACLManager');
  const ethgasTokenDeploy = await deployments.get('EthgasToken');
  const ethgasToken = await ethers.getContractAt(ethgasTokenDeploy.abi, ethgasTokenDeploy.address);
  const placeholderAddress = ethgasToken.address;
  let tokenLockDeploy = await deploy("EthgasTokenLock", {
      from: deployer,
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
        placeholderAddress,
        addressObj["snapshotDelegateRegistry"]["address"],
        addressObj["feeDistributor"]["address"]
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

const advanceVestingPeriods = async (tokenLock: EthgasTokenLock, n = 1) => {
  const vestingPeriodDuration = await tokenLock.vestingPeriodDuration()
  const buffer = 60;
  return advanceTimeAndBlock((vestingPeriodDuration.mul(n)).add(buffer).toNumber()) // advance N period
}

const advanceUnlockPeriods = async (tokenLock: EthgasTokenLock, n = 1) => {
  const unlockPeriodDuration = await tokenLock.unlockPeriodDuration()
  const buffer = 60;
  return advanceTimeAndBlock((unlockPeriodDuration.mul(n)).add(buffer).toNumber()) // advance N period
}

const moveToTime = async (tokenLock: EthgasTokenLock, target: BigNumber, buffer: number) => {
  const ts = await tokenLock.currentTime()
  const delta = target.sub(ts).add(buffer)
  return advanceTimeAndBlock(delta.toNumber())
}

const advanceToUnlockStart = async (tokenLock: EthgasTokenLock) => moveToTime(tokenLock, await tokenLock.unlockStartTime(), 60)
const advanceToUnlockEnd = async (tokenLock: EthgasTokenLock) => moveToTime(tokenLock, await tokenLock.unlockEndTime(), 60)
const advanceToAboutUnlockStart = async (tokenLock: EthgasTokenLock) =>
  moveToTime(tokenLock, await tokenLock.unlockStartTime(), -60)

const advanceToVestingCliff = async (tokenLock: EthgasTokenLock) => moveToTime(tokenLock, await tokenLock.vestingCliffTime(), 60)
const advanceToVestingEnd = async (tokenLock: EthgasTokenLock) => moveToTime(tokenLock, await tokenLock.vestingEndTime(), 60)
const advanceToAboutVestingCliff = async (tokenLock: EthgasTokenLock) =>
  moveToTime(tokenLock, await tokenLock.vestingCliffTime(), -60)

const getGassBalance = async (targetAddress: string, ethgasToken: EthgasToken) => {
  let balance = await ethgasToken.balanceOf(targetAddress);
  let formattedBalance = ethers.utils.formatEther(balance)
  console.log(`EthgasToken balance of ${targetAddress}: ${formattedBalance}`)
  return formattedBalance;
}

const forEachVestingPeriod = async (tokenLock: EthgasTokenLock, fn) => {
  const vestingPeriods = (await tokenLock.vestingPeriods()).toNumber()
  for (let currentVestingPeriod = 1; currentVestingPeriod <= vestingPeriods + 1; currentVestingPeriod++) {
    const currentVestingPeriod = await tokenLock.currentVestingPeriod()
    await fn(currentVestingPeriod.sub(1))
    await advanceVestingPeriods(tokenLock, 1)
  }
}

const shouldMatchVestingSchedule = async (tokenLock: EthgasTokenLock, fnName: string, initArgs: any) => {
  await forEachVestingPeriod(tokenLock, async function (passedVestingPeriods: BigNumber) {
    const amount = (await tokenLock.functions[fnName]())[0]
    const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
    const vestingCliffAmount = await tokenLock.vestingCliffAmount()
    const managedAmount = await tokenLock.managedAmount()
    // After last period we expect to have all managed tokens available
    const expectedAmount = passedVestingPeriods.lt(initArgs.vestingPeriods) ? passedVestingPeriods.mul(vestingAmountPerPeriod).add(vestingCliffAmount) : managedAmount
    expect(amount).eq(expectedAmount)
  })
}

const forEachUnlockPeriod = async (tokenLock: EthgasTokenLock, fn) => {
  const unlockPeriods = (await tokenLock.unlockPeriods()).toNumber()
  for (let currentUnlockPeriod = 1; currentUnlockPeriod <= unlockPeriods + 1; currentUnlockPeriod++) {
    const currentUnlockPeriod = await tokenLock.currentUnlockPeriod()
    await fn(currentUnlockPeriod.sub(1))
    await advanceUnlockPeriods(tokenLock, 1)
  }
}

const shouldMatchUnlockSchedule = async (tokenLock: EthgasTokenLock, fnName: string, initArgs: any) => {
  await forEachUnlockPeriod(tokenLock, async function (passedUnlockPeriods: BigNumber) {
    const amount = (await tokenLock.functions[fnName]())[0]
    const unlockAmountPerPeriod = await tokenLock.unlockAmountPerPeriod()
    const initialUnlockAmount = await tokenLock.initialUnlockAmount()
    const managedAmount = await tokenLock.managedAmount()
    const expectedAmount = passedUnlockPeriods.lt(initArgs.unlockPeriods) ? passedUnlockPeriods.mul(unlockAmountPerPeriod).add(initialUnlockAmount) : managedAmount
    expect(amount).eq(expectedAmount)
  })
}

// -- Tests --

describe('EthgasTokenLock', () => {
  let beneficiary1Signer: SignerWithAddress
  let beneficiary2Signer: SignerWithAddress
  let deployerSigner: SignerWithAddress;
  let contractAdminSigner: SignerWithAddress;
  let userSigners: SignerWithAddress[];
  let initArgs: any;

  let ethgasToken: EthgasToken
  let tokenLock: EthgasTokenLock
  let aclManagerAddress: string

  const fundContract = async (contract: EthgasTokenLock) => {
    const managedAmount = await contract.managedAmount()
    await ethgasToken.connect(deployerSigner).transfer(contract.address, managedAmount)
  }

  before(async function () {
    const { deployer, contractAdmin, user0, user1, user2, user3 } = await getNamedAccounts();
    deployerSigner = await ethers.getSigner(deployer);
    contractAdminSigner = await ethers.getSigner(contractAdmin);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];
    beneficiary1Signer = userSigners[0]
    beneficiary2Signer = userSigners[1]
  })

  createScheduleScenarios().forEach(async function (schedule) {
    describe('> Test scenario', function () {
      beforeEach(async function () {
        const staticArgs = {
          beneficiary: beneficiary1Signer.address,
        }
        initArgs = { ...staticArgs, ...schedule[0] }
        const fixture = setupTest(initArgs)
        ;({ ethgasToken, tokenLock, aclManagerAddress } = await fixture());

        // Move time to just before the lock or vesting period starts
        if (initArgs.revocable === false) {
          await advanceToAboutUnlockStart(tokenLock);
        } else {
          await advanceToAboutVestingCliff(tokenLock);
        }
      })

      describe('Init', function () {

        it('should be each parameter initialized properly', async function () {
          console.log('\t>> Scenario ', schedule[1])

          expect(await tokenLock.aclManager()).eq(aclManagerAddress)
          expect(await tokenLock.beneficiary()).eq(initArgs.beneficiary)
          expect(await tokenLock.token()).eq(ethgasToken.address)
          expect(await tokenLock.managedAmount()).eq(initArgs.managedAmount)
          expect(await tokenLock.unlockPeriods()).eq(initArgs.unlockPeriods)
          expect(await tokenLock.unlockStartTime()).eq(initArgs.unlockStartTime)
          expect(await tokenLock.unlockEndTime()).eq(initArgs.unlockEndTime)
          expect(await tokenLock.initialUnlockAmount()).eq(initArgs.initialUnlockAmount)
          expect(await tokenLock.revocable()).eq(initArgs.revocable)
          if (initArgs.revocable) {
            expect(await tokenLock.vestingPeriods()).eq(initArgs.vestingPeriods)
            expect(await tokenLock.vestingCliffTime()).eq(initArgs.vestingCliffTime)
            expect(await tokenLock.vestingEndTime()).eq(initArgs.vestingEndTime)
            expect(await tokenLock.vestingCliffAmount()).eq(initArgs.vestingCliffAmount)
          } else {
            expect(await tokenLock.vestingPeriods()).eq(0)
            expect(await tokenLock.vestingCliffTime()).eq(0)
            expect(await tokenLock.vestingEndTime()).eq(0)
            expect(await tokenLock.vestingCliffAmount()).eq(0)
          }
        })
      })

      describe('Balance', function () {
        describe('currentBalance()', function () {
          it('should match to deposited balance', async function () {
            // Before
            expect(await tokenLock.currentBalance()).eq(0)

            // Transfer
            const totalAmount = toEthgasToken('100')
            await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, totalAmount)

            // After
            expect(await tokenLock.currentBalance()).eq(totalAmount)
          })
        })
      })

      describe('Time & vestingPeriods', function () {
        describe('vestingDuration()', function () {
          it('should match init parameters', async function () {
            if (initArgs.revocable) {
              const vestingDuration = initArgs.vestingEndTime - initArgs.vestingCliffTime
              expect(await tokenLock.vestingDuration()).eq(toBN(vestingDuration))
            } else {
              this.skip();
            }
          })
        })

        describe('sinceVestingCliffTime()', function () {
          it('should be zero if currentTime < vestingCliffTime', async function () {
            if (initArgs.revocable) {
              const now = +new Date() / 1000
              if (now < initArgs.vestingCliffTime) {
                expect(await tokenLock.sinceVestingCliffTime()).eq(0)
              }
            } else {
              this.skip();
            }
          })

          it('should be right amount of time elapsed', async function () {
            if (initArgs.revocable) {
              await advanceToVestingCliff(tokenLock) // 60 sec after vestingCliffTime

              const elapsedTime = (await tokenLock.currentTime()).sub(initArgs.vestingCliffTime)
              expect(await tokenLock.sinceVestingCliffTime()).eq(elapsedTime)
            } else {
              this.skip();
            }
          })
        })

        describe('vestingAmountPerPeriod()', function () {
          it('should match init parameters', async function () {
            if (initArgs.revocable) {
              const vestingAmountPerPeriod = initArgs.managedAmount.sub(initArgs.vestingCliffAmount).div(initArgs.vestingPeriods)
              expect(await tokenLock.vestingAmountPerPeriod()).eq(vestingAmountPerPeriod)
            } else {
              this.skip();
            }
          })
        })

        describe('vestingPeriodDuration()', async function () {
          it('should match init parameters', async function () {
            if (initArgs.revocable) {
              const vestingPeriodDuration = (toBN(initArgs.vestingEndTime).sub(initArgs.vestingCliffTime)).div(initArgs.vestingPeriods)
              expect(await tokenLock.vestingPeriodDuration()).eq(vestingPeriodDuration)
            } else {
              this.skip();
            }
          })
        })

        describe('currentVestingPeriod()', function () {
          it('should be one (1) before start time', async function () {
            if (initArgs.revocable) {
              expect(await tokenLock.currentVestingPeriod()).eq(1)
            } else {
              this.skip();
            }
          })

          it('should return correct amount for each period', async function () {
            if (initArgs.revocable) {
              await advanceToVestingCliff(tokenLock)

              for (let currentVestingPeriod = 1; currentVestingPeriod <= initArgs.vestingPeriods; currentVestingPeriod++) {
                expect(await tokenLock.currentVestingPeriod()).eq(currentVestingPeriod)
                await advanceVestingPeriods(tokenLock, 1)
              }
            } else {
              this.skip();
            }
          })
        })

        describe('passedVestingPeriods()', function () {
          it('should return correct amount for each period', async function () {
            if (initArgs.revocable) {
              await advanceToVestingCliff(tokenLock)

              for (let currentVestingPeriod = 1; currentVestingPeriod <= initArgs.vestingPeriods; currentVestingPeriod++) {
                expect(await tokenLock.passedVestingPeriods()).eq(currentVestingPeriod - 1)
                await advanceVestingPeriods(tokenLock, 1)
              }
            } else {
              this.skip();
            }
          })
        })
      })

      describe('Time & unlockPeriods', function () {
        describe('currentTime()', function () {
          it('should return current block time', async function () {
            expect(await tokenLock.currentTime()).eq(await getLatestBlockTimestamp())
          })
        })

        describe('unlockDuration()', function () {
          it('should match init parameters', async function () {
            const unlockDuration = initArgs.unlockEndTime - initArgs.unlockStartTime
            expect(await tokenLock.unlockDuration()).eq(toBN(unlockDuration))
          })
        })

        describe('sinceUnlockStartTime()', function () {
          it('should be zero if currentTime < unlockStartTime', async function () {
            const now = +new Date() / 1000
            if (now < initArgs.unlockStartTime) {
              expect(await tokenLock.sinceUnlockStartTime()).eq(0)
            }
          })

          it('should be right amount of time elapsed', async function () {
            await advanceToUnlockStart(tokenLock)  // 60 sec after unlockStartTime

            const elapsedTime = (await tokenLock.currentTime()).sub(initArgs.unlockStartTime)
            expect(await tokenLock.sinceUnlockStartTime()).eq(elapsedTime)
          })
        })

        describe('unlockAmountPerPeriod()', function () {
          it('should match init parameters', async function () {
            const unlockAmountPerPeriod = initArgs.managedAmount.sub(initArgs.initialUnlockAmount).div(initArgs.unlockPeriods)
            expect(await tokenLock.unlockAmountPerPeriod()).eq(unlockAmountPerPeriod)
          })
        })

        describe('unlockPeriodDuration()', async function () {
          it('should match init parameters', async function () {
            const unlockPeriodDuration = (toBN(initArgs.unlockEndTime).sub(initArgs.unlockStartTime)).div(initArgs.unlockPeriods)
            expect(await tokenLock.unlockPeriodDuration()).eq(unlockPeriodDuration)
          })
        })

        describe('currentUnlockPeriod()', function () {
          it('should be one (1) before start time', async function () {
            expect(await tokenLock.currentUnlockPeriod()).eq(1)
          })

          it('should return correct amount for each period', async function () {
            await advanceToUnlockStart(tokenLock)

            for (let currentUnlockPeriod = 1; currentUnlockPeriod <= initArgs.unlockPeriods; currentUnlockPeriod++) {
              expect(await tokenLock.currentUnlockPeriod()).eq(currentUnlockPeriod)
              await advanceUnlockPeriods(tokenLock, 1)
            }
          })
        })

        describe('passedUnlockPeriods()', function () {
          it('should return correct amount for each period', async function () {
            await advanceToUnlockStart(tokenLock)

            for (let currentUnlockPeriod = 1; currentUnlockPeriod <= initArgs.unlockPeriods; currentUnlockPeriod++) {
              expect(await tokenLock.passedUnlockPeriods()).eq(currentUnlockPeriod - 1)
              await advanceUnlockPeriods(tokenLock, 1)
            }
          })
        })
      })

      describe('Vesting, Locking & Release', function () {
        describe('vestedAmount()', function () {
          it('should return zero before start time', async function () {
            expect(await tokenLock.releasableAmount()).eq(0)
          })

          it('should return correct amount for each period', async function () {
            if (initArgs.revocable) {
              await advanceToVestingCliff(tokenLock)
              await shouldMatchVestingSchedule(tokenLock, 'vestedAmount', initArgs)
            } else {
              this.skip();
            }
          })

          it('should return full managed amount after end time', async function () {
            if (initArgs.revocable) {
              await advanceToVestingEnd(tokenLock)
            }

            const managedAmount = await tokenLock.managedAmount()
            expect(await tokenLock.vestedAmount()).eq(managedAmount)
          })
        })

        describe('vestedAmount()', function () {
          it('should be fully vested if non-revocable', async function () {
            if (initArgs.revocable === false) {
              const vestedAmount = await tokenLock.vestedAmount()
              expect(vestedAmount).eq(await tokenLock.managedAmount())
            } else {
              this.skip();
            }
          })

          it('should match the vesting schedule if revocable', async function () {
            if (initArgs.revocable) {

              const cliffTime = await tokenLock.vestingCliffTime()

              await forEachVestingPeriod(tokenLock, async function (passedVestingPeriods: BigNumber) {
                const vestingCliffAmount = await tokenLock.vestingCliffAmount()
                const vestedAmount = await tokenLock.vestedAmount()
                const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
                const managedAmount = await tokenLock.managedAmount()
                const currentTime = await tokenLock.currentTime()
                let expectedAmount = managedAmount
                // Before cliff no vested tokens
                if (cliffTime.gt(0) && currentTime.lt(cliffTime)) {
                  expectedAmount = BigNumber.from(0)
                } else {
                  // After last period we expect to have all managed tokens available
                  if (passedVestingPeriods.lt(initArgs.vestingPeriods)) {
                    expectedAmount = passedVestingPeriods.mul(vestingAmountPerPeriod).add(vestingCliffAmount)
                  }
                }
                expect(vestedAmount).eq(expectedAmount)
              })
            } else {
              this.skip()
            }
          })
        })

        describe('releasableAmount()', function () {
          it('should always return zero if there is no balance in the contract', async function () {
            await forEachUnlockPeriod(tokenLock, async function () {
              const releasableAmount = await tokenLock.releasableAmount()
              expect(releasableAmount).eq(0)
            })
          })

          context('> when funded', function () {
            beforeEach(async function () {
              await fundContract(tokenLock)
            })

            it('should match the release schedule', async function () {
              await advanceToUnlockStart(tokenLock)
              await shouldMatchUnlockSchedule(tokenLock, 'releasableAmount', initArgs)
            })

            it('should subtract already released amount', async function () {
              await advanceToUnlockStart(tokenLock)

              // After one period release
              await advanceUnlockPeriods(tokenLock, 1)
              const releasableAmountPeriod1 = await tokenLock.releasableAmount()
              await tokenLock.connect(beneficiary1Signer).release(false, 0)
              expect(await tokenLock.releasableAmount()).to.eq(0)
              expect(await tokenLock.releasedAmount()).to.eq(releasableAmountPeriod1)

              // Next vestingPeriods test that we are not counting released amount on previous period
              await advanceUnlockPeriods(tokenLock, 2)
              const releasableAmountPeriod2 = await tokenLock.releasableAmount()
              await tokenLock.connect(beneficiary1Signer).release(false, 0)
              expect(await tokenLock.releasableAmount()).to.eq(0)
              expect(await tokenLock.releasedAmount()).to.eq(releasableAmountPeriod1.add(releasableAmountPeriod2))
            })
          })
        })

        describe('totalOutstandingAmount()', function () {
          it('should be the total managed amount when have not released yet', async function () {
            const managedAmount = await tokenLock.managedAmount()
            const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
            expect(totalOutstandingAmount).eq(managedAmount)
          })

          context('when funded', function () {
            beforeEach(async function () {
              await fundContract(tokenLock)
            })

            it('should be the total managed when have not started', async function () {
              const managedAmount = await tokenLock.managedAmount()
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(managedAmount)
            })

            it('should be the total managed less the already released amount', async function () {
              // Setup
              await advanceToUnlockStart(tokenLock)
              await advanceUnlockPeriods(tokenLock, 1)

              // Release
              const amountToRelease = await tokenLock.releasableAmount()
              await tokenLock.connect(beneficiary1Signer).release(false, 0)

              const managedAmount = await tokenLock.managedAmount()
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(managedAmount.sub(amountToRelease))
            })

            it('should be zero when all funds have been released', async function () {
              // Setup
              await advanceToUnlockEnd(tokenLock)

              // Release
              await tokenLock.connect(beneficiary1Signer).release(false, 0)

              // Test
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(0)
            })
          })
        })

        describe('surplusAmount()', function () {
          it('should be zero when balance under outstanding amount', async function () {
            // Setup
            await fundContract(tokenLock)

            // Test
            const surplusAmount = await tokenLock.surplusAmount()
            expect(surplusAmount).eq(0)
          })

          it('should return any balance over outstanding amount', async function () {
            // Setup
            await fundContract(tokenLock)
            await advanceToUnlockStart(tokenLock)
            await advanceUnlockPeriods(tokenLock, 1)
            await tokenLock.connect(beneficiary1Signer).release(false, 0)

            // Send extra amount
            await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, toEthgasToken('1000'))

            // Test
            const surplusAmount = await tokenLock.surplusAmount()
            expect(surplusAmount).eq(toEthgasToken('1000'))
          })
        })
      })

      describe('Beneficiary admin', function () {
        describe('changeBeneficiary()', function () {
          it('should change beneficiary', async function () {
            const tx = tokenLock.connect(beneficiary1Signer).changeBeneficiary(beneficiary2Signer.address)
            await expect(tx).emit(tokenLock, 'BeneficiaryChanged').withArgs(beneficiary2Signer.address)

            const afterBeneficiary = await tokenLock.beneficiary()
            expect(afterBeneficiary).eq(beneficiary2Signer.address)
          })

          it('reject if beneficiary is zero', async function () {
            const tx = tokenLock.connect(beneficiary1Signer).changeBeneficiary(AddressZero)
            await expect(tx).revertedWith('Empty beneficiary')
          })

          it('reject if not authorized', async function () {
            const tx = tokenLock.connect(beneficiary2Signer).changeBeneficiary(beneficiary2Signer.address)
            await expect(tx).revertedWith('!auth')
          })
        })
      })

      describe('Recovery', function () {
        beforeEach(async function () {
          await fundContract(tokenLock)
        })

        it('should cancel lock and return funds to admin', async function () {
          const beforeBalance = await ethgasToken.balanceOf(contractAdminSigner.address)
          const contractBalance = await ethgasToken.balanceOf(tokenLock.address)
          const tx = tokenLock.connect(contractAdminSigner).cancelLock()
          await expect(tx).emit(tokenLock, 'LockCanceled')

          const afterBalance = await ethgasToken.balanceOf(contractAdminSigner.address)
          const diff = afterBalance.sub(beforeBalance)
          expect(diff).eq(contractBalance)
        })

        it('reject cancel lock from non-admin', async function () {
          const tx = tokenLock.connect(beneficiary1Signer).cancelLock()
          await expect(tx).revertedWith("AccessControl: account " +  beneficiary1Signer.address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE)
        })

        it('should accept lock', async function () {
          expect(await tokenLock.isAccepted()).eq(false)
          const tx = tokenLock.connect(beneficiary1Signer).acceptLock()
          await expect(tx).emit(tokenLock, 'LockAccepted')
          expect(await tokenLock.isAccepted()).eq(true)
        })

        it('reject accept lock from non-beneficiary', async function () {
          expect(await tokenLock.isAccepted()).eq(false)
          const tx = tokenLock.connect(beneficiary2Signer).acceptLock()
          await expect(tx).revertedWith('!auth')
        })

        it('reject cancel after contract accepted', async function () {
          await tokenLock.connect(beneficiary1Signer).acceptLock()

          const tx = tokenLock.connect(contractAdminSigner).cancelLock()
          await expect(tx).revertedWith('Cannot cancel accepted contract')
        })
      })

      describe('Value transfer', function () {
        async function getState(tokenLock: EthgasTokenLock) {
          const beneficiaryAddress = await tokenLock.beneficiary()
          return {
            beneficiaryBalance: await ethgasToken.balanceOf(beneficiaryAddress),
            contractBalance: await ethgasToken.balanceOf(tokenLock.address),
            adminBalance: await ethgasToken.balanceOf(contractAdminSigner.address),
          }
        }

        describe('release()', function () {
          it('should release the scheduled amount', async function () {
            // Setup
            await fundContract(tokenLock)
            await advanceToUnlockStart(tokenLock)
            await advanceUnlockPeriods(tokenLock, 1)

            // Before state
            const before = await getState(tokenLock)

            // Release
            const amountToRelease = await tokenLock.releasableAmount()
            const tx = tokenLock.connect(beneficiary1Signer).release(false, 0)
            await expect(tx).emit(tokenLock, 'TokensReleased').withArgs(beneficiary1Signer.address, amountToRelease)

            // After state
            const after = await getState(tokenLock)
            expect(after.beneficiaryBalance).eq(before.beneficiaryBalance.add(amountToRelease))
            expect(after.contractBalance).eq(before.contractBalance.sub(amountToRelease))
            expect(await tokenLock.releasableAmount()).eq(0)
          })

          it('should release only vested amount after being revoked', async function () {
            if (initArgs.revocable) {

              // Setup
              await fundContract(tokenLock)
              await advanceToVestingCliff(tokenLock)

              // Vest some amount
              await advanceVestingPeriods(tokenLock, 2) // fwd two vestingPeriods

              // Admin revokes the contract
              await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              const vestedAmount = await tokenLock.vestedAmount()

              // Some more vestingPeriods passed
              await advanceVestingPeriods(tokenLock, 2) // fwd two vestingPeriods

              await advanceToUnlockEnd(tokenLock);

              const tx = tokenLock.connect(beneficiary1Signer).release(false, 0)
              await expect(tx).emit(tokenLock, 'TokensReleased').withArgs(beneficiary1Signer.address, vestedAmount)
            } else {
              this.skip()
            }
          })

          it('reject release vested amount before cliff', async function () {
            if (initArgs.revocable === false) return

            // Setup
            await fundContract(tokenLock)

            // Release before cliff
            const tx1 = tokenLock.connect(beneficiary1Signer).release(false, 0)
            await expect(tx1).revertedWith('No available releasable amount')

            // Release after cliff
            await advanceToVestingCliff(tokenLock)
            
            if (initArgs.vestingCliffTime < initArgs.unlockStartTime) {
              await advanceToUnlockStart(tokenLock)
            } else if (initArgs.vestingCliffAmount.eq(0)) {
              await advanceVestingPeriods(tokenLock, 1)
            }
            await tokenLock.connect(beneficiary1Signer).release(false, 0)
          })

          it('reject release if no funds available', async function () {
            // Setup
            await fundContract(tokenLock)

            // Release
            const tx = tokenLock.connect(beneficiary1Signer).release(false, 0)
            await expect(tx).revertedWith('No available releasable amount')
          })

          it('reject release if not the beneficiary', async function () {
            const tx = tokenLock.connect(beneficiary2Signer).release(false, 0)
            await expect(tx).revertedWith('!auth')
          })
        })

        describe('withdrawSurplus()', function () {
          it('should withdraw surplus balance that is over managed amount', async function () {
            // Setup
            const managedAmount = await tokenLock.managedAmount()
            const amountToWithdraw = toEthgasToken('100')
            const totalAmount = managedAmount.add(amountToWithdraw)
            await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, totalAmount)

            // Revert if trying to withdraw more than managed amount
            const tx1 = tokenLock.connect(beneficiary1Signer).withdrawSurplus(amountToWithdraw.add(1))
            await expect(tx1).revertedWith('Amount requested > surplus available')

            // Before state
            const before = await getState(tokenLock)

            // Should withdraw
            const tx2 = tokenLock.connect(beneficiary1Signer).withdrawSurplus(amountToWithdraw)
            await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1Signer.address, amountToWithdraw)

            // After state
            const after = await getState(tokenLock)
            expect(after.beneficiaryBalance).eq(before.beneficiaryBalance.add(amountToWithdraw))
            expect(after.contractBalance).eq(before.contractBalance.sub(amountToWithdraw))
          })

          it('should withdraw surplus balance that is over managed amount (less than total available)', async function () {
            // Setup
            const managedAmount = await tokenLock.managedAmount()
            const surplusAmount = toEthgasToken('100')
            const totalAmount = managedAmount.add(surplusAmount)
            await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, totalAmount)

            // Should withdraw
            const tx2 = tokenLock.connect(beneficiary1Signer).withdrawSurplus(surplusAmount.sub(1))
            await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1Signer.address, surplusAmount.sub(1))
          })

          it('should withdraw surplus balance even after the contract was released->revoked', async function () {
            if (
              initArgs.revocable === true && 
              initArgs.vestingCliffTime === initArgs.unlockStartTime &&
              initArgs.vestingEndTime === initArgs.unlockEndTime &&
              initArgs.vestingPeriods === initArgs.unlockPeriods
            ) {
              // Setup
              const managedAmount = await tokenLock.managedAmount()
              const surplusAmount = toEthgasToken('100')
              const totalAmount = managedAmount.add(surplusAmount)
              await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, totalAmount)

              // Vest some amount
              await advanceVestingPeriods(tokenLock, 2) // fwd two vestingPeriods

              // Release / Revoke
              await tokenLock.connect(beneficiary1Signer).release(false, 0)
              await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await tokenLock.connect(contractAdminSigner).withdrawRevoked();

              // Should withdraw
              const tx2 = tokenLock.connect(beneficiary1Signer).withdrawSurplus(surplusAmount)
              await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1Signer.address, surplusAmount)

              // Contract must have no balance after all actions
              const balance = await ethgasToken.balanceOf(tokenLock.address)
              expect(balance).eq(0)
            } else {
              this.skip();
            }
          })

          it('should withdraw surplus balance even after the contract was revoked->released', async function () {
            if (
              initArgs.revocable === true && 
              initArgs.vestingCliffTime === initArgs.unlockStartTime &&
              initArgs.vestingEndTime === initArgs.unlockEndTime &&
              initArgs.vestingPeriods === initArgs.unlockPeriods
            ) {
              // Setup
              const managedAmount = await tokenLock.managedAmount()
              const surplusAmount = toEthgasToken('100')
              const totalAmount = managedAmount.add(surplusAmount)
              await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, totalAmount)

              // Vest some amount
              await advanceVestingPeriods(tokenLock, 2) // fwd two vestingPeriods

              // Release / Revoke
              await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await tokenLock.connect(contractAdminSigner).withdrawRevoked();
              await tokenLock.connect(beneficiary1Signer).release(false, 0)

              // Should withdraw
              const tx2 = tokenLock.connect(beneficiary1Signer).withdrawSurplus(surplusAmount)
              await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1Signer.address, surplusAmount)

              // Contract must have no balance after all actions
              const balance = await ethgasToken.balanceOf(tokenLock.address)
              expect(balance).eq(0)
            } else {
              this.skip();
            }
          })

          it('reject withdraw if not the beneficiary', async function () {
            await ethgasToken.connect(deployerSigner).transfer(tokenLock.address, toEthgasToken('100'))

            const tx = tokenLock.connect(beneficiary2Signer).withdrawSurplus(toEthgasToken('100'))
            await expect(tx).revertedWith('!auth')
          })

          it('reject withdraw zero tokens', async function () {
            const tx = tokenLock.connect(beneficiary1Signer).withdrawSurplus(toEthgasToken('0'))
            await expect(tx).revertedWith('Amount cannot be zero')
          })

          it('reject withdraw more than available funds', async function () {
            const tx = tokenLock.connect(beneficiary1Signer).withdrawSurplus(toEthgasToken('100'))
            await expect(tx).revertedWith('Amount requested > surplus available')
          })
        })

        describe('revoke()', function () {
          beforeEach(async function () {
            await fundContract(tokenLock)
            if (initArgs.revocable) {
              await advanceToVestingCliff(tokenLock)
            }
          })

          it('should revoke and get funds back to admin', async function () {
            if (initArgs.revocable === true) {
              // Before state
              const before = await getState(tokenLock)

              // Revoke
              const beneficiaryAddress = await tokenLock.beneficiary()
              const vestedAmount = await tokenLock.vestedAmount()
              const managedAmount = await tokenLock.managedAmount()
              const unvestedAmount = managedAmount.sub(vestedAmount)
              expect(unvestedAmount).gt(0)
              let tx = await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await expect(tx).emit(tokenLock, 'TokensRevoked').withArgs(beneficiaryAddress, unvestedAmount)
              tx = await tokenLock.connect(contractAdminSigner).withdrawRevoked();
              // After state
              const after = await getState(tokenLock)
              expect(after.adminBalance).eq(before.adminBalance.add(unvestedAmount))
            } else {
              this.skip()
            }
          })

          it('reject revoke multiple times', async function () {
            if (initArgs.revocable === true) {
              await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              const tx = tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await expect(tx).revertedWith('Already revoked')
            } else {
              this.skip()
            }
          })

          it('reject revoke if not authorized', async function () {
            const tx = tokenLock.connect(beneficiary1Signer).revoke([ethers.constants.HashZero])
            await expect(tx).revertedWith("AccessControl: account " +  beneficiary1Signer.address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE)
          })

          it('reject revoke if not revocable', async function () {
            if (initArgs.revocable === false) {
              const tx = tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await expect(tx).revertedWith('Contract is non-revocable')
            } else {
              this.skip()
            }
          })

          it('reject revoke if no available unvested amount', async function () {
            if (initArgs.revocable === true) {
              // Setup
              await advanceToVestingEnd(tokenLock)

              // Try to revoke after all tokens have been vested
              const tx = tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero])
              await expect(tx).revertedWith('No available unvested amount')
            } else {
              this.skip()
            }
          })

          it('cannot delegate after revoke', async function () {
            if (initArgs.revocable === true) {
              const id = ethers.utils.formatBytes32String("preconf-dao.eth")
              await tokenLock.connect(contractAdminSigner).revoke([id])
              const tx = tokenLock.connect(beneficiary1Signer).setSnapshotDelegate(
                id,
                beneficiary2Signer.address
              )
              await expect(tx).revertedWith('revoked contract cannot perform delegation')
            } else {
              this.skip()
            }
          })
        })
      })

      describe('Timelock controlled functions', () => {
        it('timelock can update ACLManager address', async () => {
          let { deployer, contractAdmin, pauser, treasurer, bookKeeper, payouter } = await getNamedAccounts();
          const { deploy } = deployments;
          const timelockCtrlDeploy = await deployments.get('TimelockController');
          const timelockCtrl = await ethers.getContractAt("TimelockController", timelockCtrlDeploy.address)
          const newACLManager = await deploy('ACLManagerNew', { 
            from: deployer, log: true, autoMine: true,
            contract: 'ACLManager',
            args: [ contractAdmin, treasurer, timelockCtrlDeploy.address, [ pauser ], bookKeeper, payouter ],
          });
          const tokenLockDeploy = await deployments.get('EthgasTokenLock');
    
          const tokenLockInterface = new ethers.utils.Interface(tokenLockDeploy.abi);
          expect(await tokenLock.aclManager()).to.eq(aclManagerAddress);
          await (await timelockCtrl.connect(contractAdminSigner).schedule(
            tokenLock.address, 0, tokenLockInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
            ethers.constants.HashZero, ethers.constants.HashZero, 3600)
          ).wait();
    
          await hre.network.provider.request({method:"evm_increaseTime", params:[ 3600 + 1 ]});
          await hre.network.provider.request({method:"evm_mine", params:[ ]});
    
          await (await timelockCtrl.connect(contractAdminSigner).execute(
            tokenLock.address, 0, tokenLockInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
            ethers.constants.HashZero, ethers.constants.HashZero)
          ).wait();
    
          expect(await tokenLock.aclManager()).to.eq(newACLManager.address);
        });
      })

      describe("End to End", function () {
        async function getState(tokenLock: EthgasTokenLock) {
          const beneficiaryAddress = await tokenLock.beneficiary()
          return {
            beneficiaryBalance: await ethgasToken.balanceOf(beneficiaryAddress),
            contractBalance: await ethgasToken.balanceOf(tokenLock.address),
            adminBalance: await ethgasToken.balanceOf(contractAdminSigner.address),
            vestedAmount: await tokenLock.vestedAmount(),
            revokedAmount: await tokenLock.revokedAmount(),
            releasableAmount: await tokenLock.releasableAmount(),
            releasedAmount: await tokenLock.releasedAmount(),
          }
        }

        it('for fully vested before unlockStartTime, check vested amount every month then release every month after unlockStartTime\n          for no vesting schedule, directly release every month', async function () {
          if (initArgs.vestingEndTime < initArgs.unlockStartTime) {
            await tokenLock.connect(beneficiary1Signer).acceptLock();
            let tx = tokenLock.connect(contractAdminSigner).cancelLock();
            await expect(tx).revertedWith("Cannot cancel accepted contract");
            
            let newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(0);
            expect(newState.adminBalance).eq(0);
            if (initArgs.revocable) {
              expect(newState.vestedAmount).eq(0);
            } else {
              expect(newState.vestedAmount).eq(initArgs.managedAmount);
            }
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            await fundContract(tokenLock);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(initArgs.managedAmount);
            expect(newState.adminBalance).eq(0);
            if (initArgs.revocable) {
              expect(newState.vestedAmount).eq(0);
            } else {
              expect(newState.vestedAmount).eq(initArgs.managedAmount);
            }
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            if (initArgs.revocable) {
              const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
              await advanceToVestingCliff(tokenLock);
              newState = await getState(tokenLock);
              expect(newState.beneficiaryBalance).eq(0);
              expect(newState.contractBalance).eq(initArgs.managedAmount);
              expect(newState.adminBalance).eq(0);
              expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount);
              expect(newState.revokedAmount).eq(0);
              expect(newState.releasableAmount).eq(0);
              expect(newState.releasedAmount).eq(0);

              for (let i = 1; i <= initArgs.vestingPeriods; i++) {
                await advanceVestingPeriods(tokenLock, 1);
                newState = await getState(tokenLock);
                expect(newState.beneficiaryBalance).eq(0);
                expect(newState.contractBalance).eq(initArgs.managedAmount);
                expect(newState.adminBalance).eq(0);
                if (i === initArgs.vestingPeriods) {
                  expect(newState.vestedAmount).eq(initArgs.managedAmount);
                } else {
                  expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(i)));
                }
                expect(newState.revokedAmount).eq(0);
                expect(newState.releasableAmount).eq(0);
                expect(newState.releasedAmount).eq(0);
              }

              let tx = tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero]);
              await expect(tx).revertedWith("No available unvested amount")
            }

            await advanceToUnlockStart(tokenLock);
            const unlockAmountPerPeriod = await tokenLock.unlockAmountPerPeriod()
            for (let i = 0; i <= initArgs.unlockPeriods; i++) {
              if (i !== 0 || initArgs.initialUnlockAmount.gt(0)) {
                await tokenLock.connect(beneficiary1Signer).release(false, 0);
              }
              newState = await getState(tokenLock);
              expect(newState.adminBalance).eq(0);
              expect(newState.vestedAmount).eq(initArgs.managedAmount);
              expect(newState.revokedAmount).eq(0);
              expect(newState.releasableAmount).eq(0);
              if (i === 0) {
                expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount);
              } else if (i === initArgs.unlockPeriods) {
                expect(newState.releasedAmount).eq(initArgs.managedAmount);
              } else {
                expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(i)));
              }
              if (i === initArgs.unlockPeriods) {
                expect(newState.beneficiaryBalance).eq(initArgs.managedAmount);
                expect(newState.contractBalance).eq(0);
              } else {
                expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(i)));
                expect(newState.contractBalance).eq(initArgs.managedAmount.sub(initArgs.initialUnlockAmount).sub(unlockAmountPerPeriod.mul(i)));
              }
              await advanceUnlockPeriods(tokenLock, 1);
            }

            // no more change after lock ends
            await advanceUnlockPeriods(tokenLock, 1);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.managedAmount);
            expect(newState.contractBalance).eq(0);
            expect(newState.adminBalance).eq(0);
            expect(newState.vestedAmount).eq(initArgs.managedAmount);
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(initArgs.managedAmount);
          } else {
            this.skip();
          }

        })

        it('for fully vested before unlockStartTime, some token are revoked before unlockStartTime', async function () {
          if (initArgs.revocable && initArgs.vestingEndTime < initArgs.unlockStartTime) {
            const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
            const unlockAmountPerPeriod = await tokenLock.unlockAmountPerPeriod()

            let newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(0);
            expect(newState.adminBalance).eq(0);
            expect(newState.vestedAmount).eq(0);
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            await fundContract(tokenLock);

            await advanceToVestingCliff(tokenLock);

            await advanceVestingPeriods(tokenLock, 5);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(initArgs.managedAmount);
            expect(newState.adminBalance).eq(0);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero]);
            await tokenLock.connect(contractAdminSigner).withdrawRevoked();
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            let tx = tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero]);
            await expect(tx).revertedWith("Already revoked")
            await advanceVestingPeriods(tokenLock, 4);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(0);

            await advanceToUnlockStart(tokenLock);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(0);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(initArgs.initialUnlockAmount);
            expect(newState.releasedAmount).eq(0);

            await tokenLock.connect(beneficiary1Signer).release(false, 0);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount).sub(initArgs.initialUnlockAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount);

            await advanceUnlockPeriods(tokenLock, 1);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount).sub(initArgs.initialUnlockAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(unlockAmountPerPeriod);
            expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount);

            await advanceUnlockPeriods(tokenLock, 4);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount).sub(initArgs.initialUnlockAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(unlockAmountPerPeriod.mul(5));
            expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount);

            await advanceUnlockPeriods(tokenLock, 6);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount);
            expect(newState.contractBalance).eq(initArgs.managedAmount.sub(newState.revokedAmount).sub(initArgs.initialUnlockAmount));
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(unlockAmountPerPeriod.mul(5));
            expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount);

            await advanceToUnlockEnd(tokenLock);
            await tokenLock.connect(beneficiary1Signer).release(false, 0);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(5)));
            expect(newState.contractBalance).eq(0);
            expect(newState.adminBalance).eq(newState.revokedAmount);
            expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(5)));
            expect(newState.revokedAmount).eq(initArgs.managedAmount.sub(newState.vestedAmount));
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(5)));
          } else {
            this.skip();
          }
        })

        it('for partially vested before unlockStartTime, check vested amount every month then release every month after unlockStartTime', async function () {
          if (initArgs.revocable && initArgs.vestingPeriods === initArgs.unlockPeriods && initArgs.vestingEndTime > initArgs.unlockStartTime && initArgs.vestingEndTime !== initArgs.unlockEndTime) {
            const unlockPeriodDuration = await tokenLock.unlockPeriodDuration()
            const unlockAmountPerPeriod = await tokenLock.unlockAmountPerPeriod()
            const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
            await fundContract(tokenLock);
            await advanceToVestingCliff(tokenLock);

            let periodDiffBetweenVestingAndLock = Math.ceil((new Date(initArgs.unlockEndTime).getTime() - new Date(initArgs.vestingEndTime).getTime()) / (unlockPeriodDuration.toNumber()))
            let newState;
            for (let i = 1; i < periodDiffBetweenVestingAndLock; i++) {
              await advanceVestingPeriods(tokenLock, 1);
              newState = await getState(tokenLock);
              expect(newState.beneficiaryBalance).eq(0);
              expect(newState.contractBalance).eq(initArgs.managedAmount);
              expect(newState.adminBalance).eq(0);
              expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(i)));
              expect(newState.revokedAmount).eq(0);
              expect(newState.releasableAmount).eq(0);
              expect(newState.releasedAmount).eq(0);
            }

            for (let i = 0; i <= initArgs.unlockPeriods; i++) {
              await advanceTimeAndBlock(3600*24*32);
              newState = await getState(tokenLock);
              if (i === 0) {
                expect(newState.beneficiaryBalance).eq(0);
                expect(newState.contractBalance).eq(initArgs.managedAmount);
                expect(newState.releasableAmount).eq(initArgs.initialUnlockAmount);
                expect(newState.releasedAmount).eq(0);
              } else {
                expect(newState.beneficiaryBalance).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(i - 1)));
                expect(newState.contractBalance).eq(initArgs.managedAmount.sub(initArgs.initialUnlockAmount).sub(unlockAmountPerPeriod.mul(i - 1)));
                expect(newState.releasableAmount.sub(unlockAmountPerPeriod)).lt(5); // 4 wei difference for the last cycle
                expect(newState.releasedAmount).eq(initArgs.initialUnlockAmount.add(unlockAmountPerPeriod.mul(i - 1)));
              }
              expect(newState.adminBalance).eq(0);
              if (i + periodDiffBetweenVestingAndLock >= initArgs.vestingPeriods) {
                expect(newState.vestedAmount).eq(initArgs.managedAmount)
              } else {
                expect(newState.vestedAmount).eq(initArgs.vestingCliffAmount.add(vestingAmountPerPeriod.mul(i + periodDiffBetweenVestingAndLock)));
              }
              expect(newState.revokedAmount).eq(0);
              await tokenLock.connect(beneficiary1Signer).release(false, 0);
            }

            // no more change after lock ends
            await advanceUnlockPeriods(tokenLock, 1);
            newState = await getState(tokenLock);
            expect(newState.beneficiaryBalance).eq(initArgs.managedAmount);
            expect(newState.contractBalance).eq(0);
            expect(newState.adminBalance).eq(0);
            expect(newState.vestedAmount).eq(initArgs.managedAmount);
            expect(newState.revokedAmount).eq(0);
            expect(newState.releasableAmount).eq(0);
            expect(newState.releasedAmount).eq(initArgs.managedAmount);
          } else {
            this.skip();
          }

        })

        it('for vesting & unlock schedule are the same and without initial unlock', async function () {
          if (initArgs.revocable && initArgs.vestingPeriods === initArgs.unlockPeriods && initArgs.vestingCliffTime === initArgs.unlockStartTime && initArgs.vestingEndTime === initArgs.unlockEndTime) {
            const revokedPeriods = 16;
            const remainingPeriods = initArgs.unlockPeriods - revokedPeriods;
            console.log(`revoke at period ${revokedPeriods}, remainingPeriods: ${remainingPeriods}`);
            const unlockAmountPerPeriod = await tokenLock.unlockAmountPerPeriod()
            const vestingAmountPerPeriod = await tokenLock.vestingAmountPerPeriod()
            expect(unlockAmountPerPeriod).eq(vestingAmountPerPeriod);
            await fundContract(tokenLock);
            await advanceToVestingCliff(tokenLock);
            let newState;
            for (let i = 1; i <= initArgs.unlockPeriods; i++) {
              await advanceVestingPeriods(tokenLock, 1);
              newState = await getState(tokenLock);
              if (i < revokedPeriods) {
                expect(newState.beneficiaryBalance.sub(unlockAmountPerPeriod.mul(i - 1))).lte(10); // 10 wei difference due to low accuracy
                expect(initArgs.managedAmount.sub(unlockAmountPerPeriod.mul(i - 1)).sub(newState.contractBalance)).lte(10);
                expect(newState.adminBalance).eq(0);
                expect(newState.vestedAmount.sub(vestingAmountPerPeriod.mul(i)).lte(10)); 
                expect(newState.revokedAmount).eq(0);
                expect(newState.releasableAmount.sub(unlockAmountPerPeriod)).lte(10);
                expect(newState.releasedAmount).eq(unlockAmountPerPeriod.mul(i - 1));
                await tokenLock.connect(beneficiary1Signer).release(false, 0);
                newState = await getState(tokenLock);
                expect(newState.releasableAmount).eq(0);
                expect(newState.releasedAmount.sub(unlockAmountPerPeriod.mul(i))).lte(10);
              } else if (i >= revokedPeriods) {
                if (i === revokedPeriods) {
                  await tokenLock.connect(beneficiary1Signer).release(false, 0);
                  await tokenLock.connect(contractAdminSigner).revoke([ethers.constants.HashZero]);
                  await tokenLock.connect(contractAdminSigner).withdrawRevoked();
                }
                newState = await getState(tokenLock);
                expect(newState.beneficiaryBalance.sub(unlockAmountPerPeriod.mul(revokedPeriods))).lte(10); // 10 wei difference due to low accuracy
                expect(newState.contractBalance).eq(0);
                expect(newState.adminBalance.sub(vestingAmountPerPeriod.mul(2))).lte(10);
                expect(newState.vestedAmount.sub(vestingAmountPerPeriod.mul(revokedPeriods)).lte(10)); 
                expect(newState.revokedAmount.sub(vestingAmountPerPeriod.mul(2))).lte(10);
                expect(newState.releasableAmount).eq(0);
                expect(newState.releasedAmount).eq(unlockAmountPerPeriod.mul(revokedPeriods));
              }
            }
          } else {
            this.skip();
          }

        })

      })
    })
  })
})