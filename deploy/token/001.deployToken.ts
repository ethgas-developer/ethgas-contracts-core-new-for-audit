import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deploy } = hre.deployments;
    const { deployer } = await hre.getNamedAccounts();
    const configObj = require(`../../helpers/config/` + hre.network.name + `.json`);
    await deploy("EthgasToken", {
        contract: "EthgasToken", // Specify the contract to deploy
        from: deployer,
        args: [
            configObj["EthgasToken"]["name"],
            configObj["EthgasToken"]["symbol"],
            deployer,
            ethers.utils.parseEther(configObj["EthgasToken"]["totalSupply"])
        ],
        log: true,
    });
};

export default func;
func.tags = ["EthgasToken"];

