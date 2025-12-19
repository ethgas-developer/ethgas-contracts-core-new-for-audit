import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumber, Contract, Wallet } from "ethers";
import { DeployFunction, Deployment, DeploymentsExtension, ExtendedArtifact } from 'hardhat-deploy/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { EthgasPool } from '../typechain';
const lodash = require('lodash');



const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers } = hre;

  const { deploy } = deployments;
  let addressObj: Record<string, any>;
  if (hre.network.tags.testnet === true) {
      if (hre.network.tags.hoodi === true) {
        addressObj = require(`../helpers/address/hoodi.json`); 
      } else {
        console.log("Error: Unknown testnet")
        throw new Error("Error: Unknown testnet")
      }
  } else {
      addressObj = require(`../helpers/address/mainnet.json`);
  }

  
  const { DEFAULT_ADMIN_ROLE, TIMELOCK_ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE } = require(`../helpers/constants`)
  const configObj: Record<string, any> = require(`../helpers/config/` + hre.network.name + `.json`);
  const tokensConfigObj: Record<string, Record<string, any>> = configObj["Tokens"];
  const { formatTokenAmount, parseTokenAmount } = require(`../helpers/utils`)
  console.log('current block#:', await ethers.provider.getBlockNumber());
  const { 
    deployerFoundation, contractAdminFoundation, treasurerFoundation, 
    pauserFoundation, pauser1Foundation, pauser2Foundation, pauser3Foundation, proposerFoundation, bookKeeperFoundation  
  } = await getNamedAccounts();
  let deployerSigner: Wallet | SignerWithAddress = await ethers.getSigner(deployerFoundation);
  if (hre.network.tags.mainnet === true) {
    deployerSigner = (new ethers.Wallet(process.env.MAINNET_DEPLOYER_FOUNDATION_PRIVATE_KEY as string)).connect(ethers.provider)
  } else if (hre.network.tags.testnet === true) {
    if (process.env.TESTNET_DEPLOYER_FOUNDATION_PRIVATE_KEY != undefined) {
      deployerSigner = (new ethers.Wallet(process.env.TESTNET_DEPLOYER_FOUNDATION_PRIVATE_KEY as string)).connect(ethers.provider)
    }
  }
  if (deployerSigner.address !== deployerFoundation) {
    throw new Error("deployerSigner.address NOT equal to deployer")
  }
  const WETH_ADDRESS = addressObj["WETH"]["token_address"];
  let DepositHelperDeploy : Deployment = await deployments.get('DepositHelperFoundation');
  let aclManagerDeploy : Deployment = await deployments.get('ACLManagerFoundation');
  let timelockCtrlDeploy : Deployment = await deployments.get('TimelockControllerFoundation');

  let supportedTokensArr: string[] = []
  let dailyWithdrawalCapArr = []
  let dailyPayoutCapArr = []
  for (let tokenName of configObj["EthgasPoolFoundationSupportedTokens"]) {
    dailyWithdrawalCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_withdrawal_cap.toString(), tokenName))
    dailyPayoutCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_payout_cap.toString(), tokenName))
    supportedTokensArr.push(addressObj[tokenName]["token_address"])
  }
  const EthgasPool = await ethers.getContractFactory('EthgasPool', {
    signer: deployerSigner,
    libraries: {
      DepositHelper: DepositHelperDeploy.address,
    },
  });
  let ethgasPoolContract = await EthgasPool.deploy(
    aclManagerDeploy.address, WETH_ADDRESS, supportedTokensArr, dailyWithdrawalCapArr, dailyPayoutCapArr
  );


  //await ethgasPoolContract.deployed();
  console.log('deploying EthgasPoolFoundation...:  deployed at ' + ethgasPoolContract.address);
  const ethgasPoolArtifact = await deployments.getExtendedArtifact('EthgasPool');
  let ethgasPoolDeployments = {
      address: ethgasPoolContract.address,
      gasEstimates: (await ethgasPoolContract.deployTransaction.wait()).gasUsed,
      ...ethgasPoolArtifact
  }
  await deployments.save('EthgasPoolFoundation', ethgasPoolDeployments);

  console.log("\n== EthgasPool config ==")
  console.log("WETH was set as", await ethgasPoolContract.weth());
  console.log("aclManager was set as", await ethgasPoolContract.aclManager());
  for (let i = 0; i < supportedTokensArr.length; i++) {
    console.log(supportedTokensArr[i], "dailyWithdrawalCap: ", await ethgasPoolContract.dailyWithdrawalCap(supportedTokensArr[i]))
    console.log(supportedTokensArr[i], "dailyPayoutCap: ", await ethgasPoolContract.dailyPayoutCap(supportedTokensArr[i]))
    console.log(supportedTokensArr[i], "supportedToken: ", await ethgasPoolContract.supportedToken(supportedTokensArr[i]))
  }
  

  const timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, deployerSigner);
  const aclManager: Contract = await ethers.getContractAt(aclManagerDeploy.abi, aclManagerDeploy.address, deployerSigner);

  if ( (await aclManager.hasRole(DEFAULT_ADMIN_ROLE, deployerFoundation)) ) {
    await (await aclManager.renounceRole(DEFAULT_ADMIN_ROLE, deployerFoundation)).wait();
    console.log("deployer renounced DEFAULT_ADMIN_ROLE")
  }

 


  console.log('current block#:', await ethers.provider.getBlockNumber());

  let roleInfo: Record<string, string>[]= []
  let roleNames: string[] = [];
  let roleAddresses: string[] = [];
  if (hre.network.tags.mainnet === true) {
    roleNames = [ 
      "deployerFoundation", "contractAdminFoundation", "treasurerFoundation", 
      "pauserFoundation", "pauser1Foundation", "pauser2Foundation", "pauser3Foundation", "proposerFoundation", "bookKeeperFoundation", "payouterFoundation" ]
    roleAddresses = [ 
      deployerFoundation, contractAdminFoundation, treasurerFoundation, 
      pauserFoundation, pauser1Foundation, pauser2Foundation, pauser3Foundation, proposerFoundation, bookKeeperFoundation, treasurerFoundation
    ]
  } else {
    roleNames = [ 
      "deployerFoundation", "contractAdminFoundation", "treasurerFoundation",
      "pauserFoundation", "proposerFoundation", "bookKeeperFoundation", "payouterFoundation" ]
    roleAddresses = [ 
      deployerFoundation, contractAdminFoundation, treasurerFoundation, 
      pauserFoundation, proposerFoundation, bookKeeperFoundation, treasurerFoundation ]
  }
  for (let i = 0; i < roleNames.length; i++ ) {
    let tempObj: Record<string, any> = {}
    tempObj["role"] = roleNames[i]
    tempObj["address"] = roleAddresses[i]
    tempObj["isAclAdmin"] = await aclManager.hasRole(DEFAULT_ADMIN_ROLE, roleAddresses[i])
    tempObj["isTimelockAdmin"] = await timelockCtrl.hasRole(TIMELOCK_ADMIN_ROLE, roleAddresses[i])
    tempObj["isTimelockProposer"] = await timelockCtrl.hasRole(PROPOSER_ROLE, roleAddresses[i])
    tempObj["isTimelockExecutor"] = await timelockCtrl.hasRole(EXECUTOR_ROLE, roleAddresses[i])
    roleInfo.push(tempObj)
  }
  console.table(roleInfo);

  let totalDeploymentGasUnits = BigNumber.from(0);
  
  const allDeployments = await deployments.all();
  let deploymentInfo: Record<string, string>[]= []
  Object.keys(allDeployments).forEach((key) => {
    let tempObj: Record<string, any> = {}
    tempObj["contract"] = key
    tempObj["address"] = allDeployments[key].address
    tempObj["gasUsed"] = allDeployments[key].gasEstimates;
    if (key === "EthgasPoolFoundation" || key === "EthgasPool") {
      tempObj["gasUsed"] = BigNumber.from(allDeployments[key].gasEstimates).toString();
      totalDeploymentGasUnits = totalDeploymentGasUnits.add(BigNumber.from(allDeployments[key].gasEstimates));
    } else {
      tempObj["gasUsed"] = allDeployments[key].receipt?.gasUsed!;
      totalDeploymentGasUnits = totalDeploymentGasUnits.add(allDeployments[key].receipt?.gasUsed!);
    }
    deploymentInfo.push(tempObj)
  })

  console.log("\n== Deployment Addresses ==")
  console.table(deploymentInfo);
  console.log("Total deployment gas units: " + totalDeploymentGasUnits!.toString())
};
export default func;
func.tags = ['EthgasPoolFoundation'];
