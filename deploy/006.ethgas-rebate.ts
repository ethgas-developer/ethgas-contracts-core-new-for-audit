import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction,Deployment } from 'hardhat-deploy/types';
import {  Contract, Wallet } from "ethers";
import { formatTokenAmount, parseTokenAmount } from "../helpers/utils"
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts, ethers } = hre;
    console.log('current block#:', await ethers.provider.getBlockNumber());

    const { deploy } = deployments;
    const { deployer, contractAdmin, pauser } = await getNamedAccounts();
    let addressObj: Record<string, any>;
    let gweiAddress;
    let vegweiAddress;
    if (hre.network.tags.testnet === true) {
        if (hre.network.tags.sepolia === true) {
          addressObj = require(`../helpers/address/sepolia.json`); 
        } else if (hre.network.tags.hoodi === true) {
          addressObj = require(`../helpers/address/hoodi.json`); 
        } else {
          console.log("Error: Unknown testnet")
          throw new Error("Error: Unknown testnet")
        }
    } else if (hre.network.name === "local") {
          addressObj = require(`../helpers/address/local.json`); 
    } else {
        addressObj = require(`../helpers/address/mainnet.json`);
    }
    const WETH_ADDRESS = addressObj["WETH"]["token_address"];
    if (hre.network.name === "hardhat") {
      gweiAddress = WETH_ADDRESS;
      vegweiAddress = WETH_ADDRESS;
    } else {
      gweiAddress = addressObj["GWEI"]["token_address"];
      vegweiAddress = addressObj["VEGWEI"]["token_address"];
    }
    const configObj: Record<string, any> = require(`../helpers/config/` + hre.network.name + `.json`);
    const tokensConfigObj: Record<string, Record<string, any>> = configObj["Tokens"];
    const { DEFAULT_ADMIN_ROLE } = require(`../helpers/constants`)
    let supportedTokensArr: string[] = [];
    
    let aclManagerDeploy : Deployment = await deployments.get('ACLManager');
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

    let dailyWithdrawalCapArr = []
    for (let tokenName of configObj["EthgasRebateSupportedTokens"]) {
      dailyWithdrawalCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_withdrawal_cap.toString(), tokenName))
      supportedTokensArr.push(addressObj[tokenName]["token_address"])
    }

    if (hre.network.tags.mainnet === true || hre.network.tags.testnet === true) {
      console.log("waiting for 15 seconds to double-check all config")
      console.log(`aclManagerDeploy: ${aclManagerDeploy.address}`)
      console.log(`supportedTokensArr: ${supportedTokensArr}`)
      console.log(`dailyWithdrawalCapArr: ${dailyWithdrawalCapArr}`)
      console.log(`WETH: ${WETH_ADDRESS}`)
      console.log(`GWEI: ${gweiAddress}`)
      console.log(`VEGWEI: ${vegweiAddress}`)
      await new Promise(resolve => setTimeout(resolve, 15 * 1000));
    }

    await deploy('EthgasRebate', { 
        from: deployer,
        log: true,
        args: [ 
            aclManagerDeploy.address, supportedTokensArr, dailyWithdrawalCapArr, WETH_ADDRESS, gweiAddress, vegweiAddress

        ],  
    });

    const aclManager : Contract = await ethers.getContractAt(aclManagerDeploy.abi, aclManagerDeploy.address, deployerSigner);
    if ( (await aclManager.hasRole(DEFAULT_ADMIN_ROLE, deployer)) ) 
    {
        console.log("renounce deployer admin role")
        await (await aclManager.renounceRole(DEFAULT_ADMIN_ROLE, deployer)).wait();
    }

};

export default func;
func.tags = ['EthgasRebate'];