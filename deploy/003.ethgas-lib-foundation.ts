import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Wallet } from "ethers";
import { DeployFunction } from 'hardhat-deploy/types';
import fs from "fs";
import path from "path";
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
const lodash = require('lodash');
const { TIMELOCK_ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, BOOKKEEPER_ROLE } = require(`../helpers/constants`)
const { parseTokenAmount } = require(`../helpers/utils`)

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;
  console.log('current block#:', await ethers.provider.getBlockNumber());
  const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
  const MIN_DELAY_SECS = configObj["TimelockControllerMinDelayInSecond"]

  const { deploy } = deployments;
  const { 
    deployerFoundation, contractAdminFoundation, treasurerFoundation, 
    pauserFoundation, pauser1Foundation, pauser2Foundation, pauser3Foundation, proposerFoundation, bookKeeperFoundation 
  } = await getNamedAccounts();
  console.log("== Special Role Addresses ==")
  if (hre.network.tags.mainnet === true) {
    console.table({
      deployerFoundation,
      contractAdminFoundation,
      treasurerFoundation, 
      pauserFoundation,
      pauser1Foundation,
      pauser2Foundation,
      pauser3Foundation,
      proposerFoundation,
      bookKeeperFoundation
    })
  } else {
    console.table({
      deployerFoundation,
      contractAdminFoundation,
      treasurerFoundation, 
      pauserFoundation,
      proposerFoundation,
      bookKeeperFoundation
    })
  }
  console.log("TimelockController min delay in second:", MIN_DELAY_SECS)
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting for 60 seconds to double-check special role addresses and min delay")
    await new Promise(resolve => setTimeout(resolve, 60 * 1000));
  }

  let deployerSigner: Wallet | SignerWithAddress = await ethers.getSigner(deployerFoundation);
  if (hre.network.tags.mainnet === true) {
    deployerSigner = (new ethers.Wallet(process.env.MAINNET_DEPLOYER_FOUNDATION_PRIVATE_KEY as string)).connect(ethers.provider)
  } 
  else if (hre.network.tags.testnet === true) 
  {
    if (process.env.TESTNET_DEPLOYER_FOUNDATION_PRIVATE_KEY != undefined) 
    {
      deployerSigner = (new ethers.Wallet(process.env.TESTNET_DEPLOYER_FOUNDATION_PRIVATE_KEY as string)).connect(ethers.provider)
    }
  }
  if (deployerSigner.address !== deployerFoundation) {
   throw new Error("deployerSigner.address NOT equal to deployer")
  }

  await deploy('DepositHelperFoundation', 
    {
      contract: "DepositHelper", 
      from: deployerFoundation, log: true, autoMine: true
    }
  );
 
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting 10 seconds for blockchain to process...");
    await new Promise(resolve => setTimeout(resolve, 10 * 1000));
  }



  const timelockCtrlDeploy = await deploy('TimelockControllerFoundation', { 
    contract: "TimelockController",
    from: deployerFoundation, log: true, autoMine: true,
    args: [ MIN_DELAY_SECS, [proposerFoundation, contractAdminFoundation], [ contractAdminFoundation ] ]
  });
  console.log("Timelock delay was set as", MIN_DELAY_SECS, "seconds");
  const timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, deployerSigner);
  await (await timelockCtrl.renounceRole(TIMELOCK_ADMIN_ROLE, deployerFoundation)).wait();
  console.log("deployer renounced TIMELOCK_ADMIN_ROLE");
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting 20 seconds for blockchain to process...");
    await new Promise(resolve => setTimeout(resolve, 20 * 1000));
  }

  let pausers = []
  if (hre.network.tags.mainnet === true) {
    pausers = [ pauserFoundation, pauser1Foundation, pauser2Foundation, pauser3Foundation ];
  } else {
    pausers = [ pauserFoundation ];
  }
  const aclManagerDeploy = await deploy('ACLManagerFoundation', { 
    contract: "ACLManager",
    from: deployerFoundation, log: true, autoMine: true,
    args: [ contractAdminFoundation, treasurerFoundation, timelockCtrlDeploy.address, pausers, bookKeeperFoundation, treasurerFoundation ],
  });

  const aclManager = await ethers.getContractAt(aclManagerDeploy.abi, aclManagerDeploy.address, deployerSigner);
  await (await aclManager.grantRole(BOOKKEEPER_ROLE, contractAdminFoundation)).wait();
  console.log("granted admin as BOOKKEEPER_ROLE")

};
export default func;
func.tags = ['EthgasSetupFoundation'];
