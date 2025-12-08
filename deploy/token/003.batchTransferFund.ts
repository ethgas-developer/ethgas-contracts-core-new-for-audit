import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs";
import csv from "csv-parser";
import { parse } from "json2csv";
import { Contract, Wallet } from "ethers";
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { formatTokenAmount, parseTokenAmount } from "../../helpers/utils"

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deploy, getOrNull } = hre.deployments;
    const { deployments, getNamedAccounts, ethers } = hre;

    const { deployer } = await hre.getNamedAccounts();
    const ethgasPoolDeploy = await deployments.get("EthgasPool");
    const ethgasRebateDeploy = await deployments.get("EthgasRebate");
    ////////////////////////////////////
    ///////// to be confirmed //////////
    ////////////////////////////////////
    const treasuryAddress = ethgasPoolDeploy.address;
    ////////////////////////////////////
    ////////////////////////////////////

    const configObj: Record<string, any> = require(`../../helpers/config/` + hre.network.name + `.json`);
    const tokensConfigObj: Record<string, Record<string, any>> = configObj["Tokens"];

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

    // Deploy BatchTransfer contract (will be new each time)
    const batchTransfer = await deploy("BatchTransfer", {
        contract: "BatchTransfer",
        from: deployer,
        log: true,
    });

    const ethgasToken = await ethers.getContractAt("EthgasToken", (await deployments.get("EthgasToken")).address, deployerSigner);
    const batchTransferContract = await ethers.getContractAt("BatchTransfer", batchTransfer.address, deployerSigner);

    // Read the CSV file
    const results: any[] = [];
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream(`./helpers/token-config/tokenLock-${hre.network.name}.csv`)
            .pipe(csv())
            .on("data", (data) => results.push(data))
            .on("end", async () => {
                // Prepare batch transfer data
                const recipients: string[] = [];
                const amounts: any[] = [];
                const updatedRows: any[] = [];

                for (const row of results) {
                    if (row.transferred === "TRUE") {
                        console.log(`Skipping ${row.name} (${row.beneficiary}) as already transferred.`);
                        updatedRows.push(row);
                        continue;
                    }

                    const name = row.name;
                    const beneficiary = row.beneficiary;
                    const managedAmount = ethers.utils.parseEther(row.managedAmount);
                    const contractName = `EthgasTokenLock_${name}_${beneficiary}`;
                    const existingContract = await getOrNull(contractName);

                    if (!existingContract) {
                        console.log(`EthgasTokenLock for beneficiary ${beneficiary} not exist`);
                        updatedRows.push(row);
                    } else {
                        // Add managedAmount transfer to contract
                        recipients.push(existingContract.address);
                        amounts.push(managedAmount);

                        // Mark as transferred
                        row.transferred = "TRUE";
                        updatedRows.push(row);
                    }
                }

                // Execute single batch transfer if there are transfers to make
                if (recipients.length > 0) {
                    // Calculate total amount needed
                    const totalTransferOutAmount = amounts.reduce((sum, amount) => sum.add(amount), ethers.BigNumber.from(0));
                    const totalSupply = await ethgasToken.totalSupply();
                    const initAmountForEthgasRebate = parseTokenAmount(tokensConfigObj["GWEI"].InitAmountForEthgasRebate.toString(), "GWEI")
                    recipients.push(ethgasRebateDeploy.address);
                    amounts.push(initAmountForEthgasRebate);
                    console.log(`pending to transfer ${initAmountForEthgasRebate} to EthgasRebate ${ethgasRebateDeploy.address}`)
                    const remainingAmountForTreasury = totalSupply.sub(totalTransferOutAmount).sub(initAmountForEthgasRebate);
                    recipients.push(treasuryAddress);
                    amounts.push(remainingAmountForTreasury);
                    console.log(`pending to transfer ${remainingAmountForTreasury} to EthgasPool ${treasuryAddress}`)
                    console.log(`Executing ${recipients.length} transfers using BatchTransfer contract...`);
                    
                    // Approve the BatchTransfer contract to spend tokens
                    console.log(`Approving ${totalSupply} tokens to BatchTransfer contract...`);
                    const approveTx = await ethgasToken.approve(batchTransfer.address, totalSupply);
                    await approveTx.wait();
                    console.log("Approval completed");
                    
                    if (hre.network.tags.mainnet === true) {
                        console.log("waiting for 15 seconds to double-check the amount")
                        await new Promise(resolve => setTimeout(resolve, 15 * 1000));
                    }
                    // Execute single batch transfer transaction
                    const batchTx = await batchTransferContract.batchTransferToken(ethgasToken.address, recipients, amounts);
                    await batchTx.wait();
                    
                    console.log("All transfers completed using BatchTransfer contract!");
                    console.log(`Transaction hash: ${batchTx.hash}`);
                } else {
                    console.log("No transfers to execute.");
                }

                // Write back to CSV
                const fields = Object.keys(updatedRows[0]);
                const csvData = parse(updatedRows, { fields });
                fs.writeFileSync(`./helpers/token-config/tokenLock-${hre.network.name}.csv`, csvData, "utf8");
                resolve();
            })
            .on("error", reject);
    });
};

export default func;
func.tags = ["BatchTransferFund"];
// func.dependencies = ["EthgasTokenLock", "EthgasToken"];