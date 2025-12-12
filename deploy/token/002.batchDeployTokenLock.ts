import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import csv from "csv-parser";
import {  Contract, Wallet } from "ethers";
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ACLManager } from "../../typechain";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deploy, getOrNull } = hre.deployments;
    const { deployer } = await hre.getNamedAccounts();
    const { deployments, getNamedAccounts, ethers } = hre;

    let addressObj: Record<string, any>;
    if (hre.network.tags.testnet === true) {
        if (hre.network.tags.sepolia === true) {
          addressObj = require(`../../helpers/address/sepolia.json`); 
        } else if (hre.network.tags.hoodi === true) {
          addressObj = require(`../../helpers/address/hoodi.json`); 
        } else {
          console.log("Error: Unknown testnet")
          throw new Error("Error: Unknown testnet")
        }
    } else if (hre.network.name === "local") {
        addressObj = require(`../../helpers/address/local.json`); 
    } else {
        addressObj = require(`../../helpers/address/mainnet.json`);
    }
    const configObj = require(`../../helpers/config/` + hre.network.name + `.json`);

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
    // Read the CSV file
    const results: any[] = [];
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(`./helpers/token-config/tokenLock-${hre.network.name}.csv`)
            .pipe(csv())
            .on("data", (data: any) => results.push(data))
            .on("end", async () => {
                // Batch deploy EthgasTokenLock contracts
                for (const row of results) {
                    const name = row.name;

                    const beneficiary = row.beneficiary;
                    const managedAmount = ethers.utils.parseEther(row.managedAmount);
                    const unlockPeriods = parseInt(row.unlockPeriods);
                    const unlockStartTime = new Date(row.unlockStartTime).getTime() / 1000;
                    const unlockEndTime = new Date(row.unlockEndTime).getTime() / 1000;
                    const initialUnlockAmount = ethers.utils.parseEther(row.initialUnlockAmount);
                    let revocable: boolean
                    if (row.revocable === "TRUE") {
                        revocable = true
                    } else if (row.revocable === "FALSE") {
                        revocable = false
                    } else {
                        throw Error("revocable can either be TRUE or FALSE")
                    }
                    const vestingPeriods = parseInt(row.vestingPeriods);
                    const vestingCliffTime = new Date(row.vestingCliffTime).getTime() / 1000;
                    const vestingEndTime = new Date(row.vestingEndTime).getTime() / 1000;
                    const vestingCliffAmount = ethers.utils.parseEther(row.vestingCliffAmount);

                    // Generate a unique contract name
                    const contractName = `EthgasTokenLock_${name}_${beneficiary}`;

                    // Check if the contract has already been deployed
                    const existingContract = await getOrNull(contractName);
                    let tokenLockWallet;
                    const aclManagerDeploy = await deployments.get('ACLManager');
                    const ethgasTokenDeploy = await deployments.get('EthgasToken');

                    const args = [
                        aclManagerDeploy.address,
                        beneficiary,
                        ethgasTokenDeploy.address,
                        managedAmount, 
                        {
                            unlockPeriods,
                            unlockStartTime,
                            unlockEndTime,
                            initialUnlockAmount
                        },
                        revocable,
                        {
                            vestingPeriods, 
                            vestingCliffTime, 
                            vestingEndTime,
                            vestingCliffAmount
                        },
                        addressObj["VEGWEI"]["token_address"],
                        addressObj["snapshotDelegateRegistry"]["address"],
                        addressObj["feeDistributor"]["address"],
                        configObj["earliestStakingTimeForTokenLock"]
                    ]
                    console.log(args)
                    if (hre.network.tags.mainnet === true) {
                        console.log("waiting for 15 seconds to double-check the args")
                        await new Promise(resolve => setTimeout(resolve, 15 * 1000));
                    }

                    if (!existingContract) {
                        // Deploy a new EthgasTokenLock contract
                        tokenLockWallet = await deploy(contractName, {
                            contract: "EthgasTokenLock", // Specify the contract to deploy
                            from: deployer,
                            log: true,
                            args
                        });
                        console.log("EthgasTokenLock deployed at:", tokenLockWallet.address);
                    } else {
                        // Use the existing contract
                        console.log("EthgasTokenLock already deployed at:", existingContract.address);
                    }
                }
                resolve();
            })
            .on("error", reject);
    });
};

export default func;
func.tags = ["EthgasTokenLock"];
