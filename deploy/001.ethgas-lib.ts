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
  let { deployer, contractAdmin, treasurer, pauser, pauser1, pauser2, pauser3, proposer, bookKeeper, payouter } = await getNamedAccounts();
  console.log("== Special Role Addresses ==")
  if (hre.network.tags.mainnet === true) {
    console.table({
      deployer,
      contractAdmin,
      treasurer, 
      pauser,
      pauser1,
      pauser2,
      pauser3,
      proposer,
      bookKeeper,
      payouter
    })
  } else {
    console.table({
      deployer,
      contractAdmin,
      treasurer, 
      pauser,
      proposer,
      bookKeeper,
      payouter
    })
  }
  console.log("TimelockController min delay in second:", MIN_DELAY_SECS)
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting for 60 seconds to double-check special role addresses and min delay")
    await new Promise(resolve => setTimeout(resolve, 60 * 1000));
  }

  let deployerSigner: Wallet | SignerWithAddress = await ethers.getSigner(deployer);
  if (hre.network.tags.mainnet === true) {
    deployerSigner = (new ethers.Wallet(process.env.MAINNET_DEPLOYER_PRIVATE_KEY as string)).connect(ethers.provider)
  } 
  else if (hre.network.tags.testnet === true) 
  {
    if (process.env.TESTNET_DEPLOYER_PRIVATE_KEY != undefined) 
    {
      deployerSigner = (new ethers.Wallet(process.env.TESTNET_DEPLOYER_PRIVATE_KEY as string)).connect(ethers.provider)
    }
  }
  if (deployerSigner.address !== deployer) {
   throw new Error("deployerSigner.address NOT equal to deployer")
  }
  if (hre.network.tags.testnet === true) {
    let addressObj;
    if (hre.network.tags.sepolia === true) {
      console.log("Deploying on Sepolia testnet")
      addressObj = require(`../helpers/address/sepolia.json`); 
    }
    else if (hre.network.tags.holesky === true) {
      console.log("Deploying on Holesky testnet")
      addressObj = require(`../helpers/address/holesky.json`); 
    }
    else if (hre.network.tags.hoodi === true) {
      console.log("Deploying on Hoodi testnet")
      addressObj = require(`../helpers/address/hoodi.json`); 
    }
    else if (hre.network.tags.dev_chain === true) {
      console.log("Deploying on dev_chain testnet")
      addressObj = require(`../helpers/address/dev_chain.json`); 
    }
    else if (hre.network.tags.dev_pectra === true) {
      console.log("Deploying on dev_pectra testnet")
      addressObj = require(`../helpers/address/dev_pectra.json`); 
    }
    else
    {
      console.log("Error: Unknown testnet")
      throw new Error("Error: Unknown testnet")
    }
    
    const tokensConfigObj = configObj['Tokens'];
    let TestERC20List : any[] = [];
    TestERC20List = Object.values(tokensConfigObj).filter((value:any) => value.test_token === true);
    let wethAddress!: string;
    let mockERC20Promise = [];
    let i = 0;
    let nonce = await deployerSigner.getTransactionCount();
    for (let token of TestERC20List) {
      const symbol = token.test_token_symbol.toString().toUpperCase();

      if (symbol === "WETH") {
        mockERC20Promise[i] = deploy(`MockERC20_${symbol}`, {
          contract: 'MockWETH',
          from: deployer,
          args: [token.test_token_name, 
            token.test_token_symbol, 
            token.test_token_decimals,
            BigNumber.from(token.test_token_amt_from_req).mul(BigNumber.from(10).pow(token.test_token_decimals))],
          log: true,
          autoMine: true,
          nonce: nonce + i
        });
      } else {
        mockERC20Promise[i] = deploy(`MockERC20_${symbol}`, {
          contract: 'MockERC20',
          from: deployer,
          args: [token.test_token_name, 
            token.test_token_symbol, 
            token.test_token_decimals,
            BigNumber.from(token.test_token_amt_from_req).mul(BigNumber.from(10).pow(token.test_token_decimals))],
          log: true,
          autoMine: true,
          nonce: nonce + i
        });
      }
      i++;
    }
    let mockERC20Deploy = await Promise.all(mockERC20Promise);
    console.log("Test tokens deployed");
    nonce = await deployerSigner.getTransactionCount();
    let mockERC20List = [];
    let j = 0;
    for (let i = 0; i < mockERC20Deploy.length; i++) 
    {
      mockERC20List[i] = await ethers.getContractAt('MockERC20', mockERC20Deploy[i].address, deployerSigner);
      console.log("Minting MockERC20 token: " + await mockERC20List[i].symbol());
      j++;
      mockERC20List[i].connect(deployerSigner).adminSetTokenBalance(
        deployer, parseTokenAmount("100000", await mockERC20List[i].symbol()), {nonce: nonce + j}
      );
      j++;
      addressObj[(await mockERC20List[i].symbol()).toUpperCase()]["token_address"] = mockERC20Deploy[i].address;
      if(await mockERC20List[i].symbol() === "WETH") {
        wethAddress = mockERC20Deploy[i].address;

      }     
    }
    await Promise.all(mockERC20List);
    let mockWETH = await ethers.getContractAt('MockWETH', wethAddress, deployerSigner);
    await (await mockWETH.connect(deployerSigner).deposit(
      {value: parseTokenAmount("0.1","ETH")}
    )).wait();

    if (hre.network.tags.sepolia === true) {
      fs.writeFileSync(path.join(__dirname, "..", "helpers", "address", "sepolia.json"), JSON.stringify(addressObj));
    }
    else if (hre.network.tags.holesky === true) {
      fs.writeFileSync(path.join(__dirname, "..", "helpers", "address", "holesky.json"), JSON.stringify(addressObj));
    }
    else if (hre.network.tags.hoodi === true) {
      fs.writeFileSync(path.join(__dirname, "..", "helpers", "address", "hoodi.json"), JSON.stringify(addressObj));
    }
    else if (hre.network.tags.dev_chain === true) {
      fs.writeFileSync(path.join(__dirname, "..", "helpers", "address", "dev_chain.json"), JSON.stringify(addressObj));
    }
    else if (hre.network.tags.dev_pectra === true) {
      fs.writeFileSync(path.join(__dirname, "..", "helpers", "address", "dev_pectra.json"), JSON.stringify(addressObj));
    }
    else
    {
      console.log("Error: Unknown testnet")
      throw new Error("Error: Unknown testnet")
    }
  }

  const DepositHelperDeploy = await deploy('DepositHelper', 
    { 
      from: deployer, log: true, autoMine: true
    }
  );
 
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting 10 seconds for blockchain to process...");
    await new Promise(resolve => setTimeout(resolve, 10 * 1000));
  }



  const timelockCtrlDeploy = await deploy('TimelockController', { 
    from: deployer, log: true, autoMine: true,
    args: [ MIN_DELAY_SECS, [proposer, contractAdmin], [ contractAdmin ] ]
  });
  console.log("Timelock delay was set as", MIN_DELAY_SECS, "seconds");
  const timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, deployerSigner);
  await (await timelockCtrl.renounceRole(TIMELOCK_ADMIN_ROLE, deployer)).wait();
  console.log("deployer renounced TIMELOCK_ADMIN_ROLE");
  if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
    console.log("waiting 20 seconds for blockchain to process...");
    await new Promise(resolve => setTimeout(resolve, 20 * 1000));
  }

  let pausers = []
  if (hre.network.tags.mainnet === true) {
    pausers = [ pauser, pauser1, pauser2, pauser3 ];
  } else {
    pausers = [ pauser ];
  }
  const aclManagerDeploy = await deploy('ACLManager', { 
    from: deployer, log: true, autoMine: true,
    
    args: [ contractAdmin, treasurer, timelockCtrlDeploy.address, pausers, bookKeeper, payouter ],
  });

  const aclManager = await ethers.getContractAt(aclManagerDeploy.abi, aclManagerDeploy.address, deployerSigner);
  await (await aclManager.grantRole(BOOKKEEPER_ROLE, contractAdmin)).wait();
  console.log("granted admin as BOOKKEEPER_ROLE")

};
export default func;
func.tags = ['EthgasSetup'];
