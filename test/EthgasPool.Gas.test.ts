import { ethers, network, waffle, getNamedAccounts, deployments } from "hardhat";
const { loadFixture } = waffle;
import { BigNumber, ContractReceipt, constants, Contract, ContractTransaction } from 'ethers';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EthgasPool} from '../typechain';
import hre from "hardhat";
const addressObj = require(`../helpers/address/mainnet.json`);
const USDT_ADDRESS = addressObj["USDT"]["token_address"];
const WSTETH_ADDRESS = addressObj["WSTETH"]["token_address"];
const WETH_ADDRESS = addressObj["WETH"]["token_address"];
const RANDOM_ADDRESS_1 = addressObj["RANDOM"][0];
const RANDOM_ADDRESS_2 = addressObj["RANDOM"][1];
const RANDOM_ADDRESS_3 = addressObj["RANDOM"][2];
const configObj: Record<string, any> = require(`../helpers/config/` + hre.network.name + `.json`);
const tokensConfigObj = configObj['Tokens'];
const { formatTokenAmount, parseTokenAmount } = require(`../helpers/utils`)
const { NATIVE_ETH_ADDRESS } = require(`../helpers/constants`)
import chaiAsPromised from 'chai-as-promised';
import chai from "chai";
chai.use(chaiAsPromised);

const ethMarketPriceInUsd = "2000";
const ethGasPrice = ethers.utils.parseUnits("1", "gwei");

describe("Gas Test", () => {
    let deployerSigner: SignerWithAddress;
    let contractAdminSigner: SignerWithAddress;
    let treasurerSigner: SignerWithAddress;
    let payouterSigner: SignerWithAddress;
    let pauserSigner: SignerWithAddress;
    let userSigners: SignerWithAddress[];
    let pool: EthgasPool;

    const fixture = async ()=>{
        const { deployer, contractAdmin, treasurer, payouter, pauser, user0, user1, user2, user3 } = await getNamedAccounts();
        deployerSigner = await ethers.getSigner(deployer);
        contractAdminSigner = await ethers.getSigner(contractAdmin);
        treasurerSigner = await ethers.getSigner(treasurer);
        payouterSigner = await ethers.getSigner(payouter);
        pauserSigner = await ethers.getSigner(pauser);
        userSigners = [ 
        await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
        ];
        await deployments.fixture(['EthgasSetup','EthgasPool']);
        const poolDeploy = await deployments.get('EthgasPool');
        pool = await ethers.getContractAt(poolDeploy.abi, poolDeploy.address, contractAdminSigner) as EthgasPool;
        await network.provider.request({method:"hardhat_setBalance", params:[pool.address, ethers.utils.hexStripZeros(ethers.utils.parseEther("10").toHexString())]});
    }

    beforeEach('load fixture', async()=>{
        await loadFixture(fixture);
        let walletAddress: string;
        let walletSigner: SignerWithAddress;
        let tokenAddress: string;
        let sendAmount: BigNumber;
        let erc20Contract: Contract;
 
        for (let tokenName of configObj["EthgasPoolSupportedTokens"]) {
            walletAddress = addressObj[tokenName]["impersonate_holder_address"];
            tokenAddress = addressObj[tokenName]["token_address"];
            sendAmount = parseTokenAmount(tokensConfigObj[tokenName]["test_fund_transfer_amount"].toString(), tokenName.toString());
            await network.provider.request({method: "hardhat_impersonateAccount", params: [ walletAddress ]});
            walletSigner = await ethers.getSigner(walletAddress);
            erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', tokenAddress, walletSigner);
            await ( await erc20Contract.approve(pool.address, sendAmount) ).wait();
            await (
                await pool.connect(walletSigner).deposit(
                    [ {token: tokenAddress, amount: sendAmount } ]
                )
            ).wait()
        }
    });

    describe('Gas Test', ()=>{

        it("serverTransferFundSingle for 1 user with 1 token", async() => {     
            console.log("ethMarketPriceInUsd:", ethMarketPriceInUsd, "ethGasPrice:", ethers.utils.formatUnits(ethGasPrice, "gwei"), "gwei")

            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFundSingle(
                RANDOM_ADDRESS_1, [ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]
            )).wait()

            let gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)


            receipt = await( await pool.connect(treasurerSigner).serverTransferFundSingle(
                RANDOM_ADDRESS_2, [ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]
            )).wait()
            gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`gas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")} (2nd transfer costs less)`)

            receipt = await( await pool.connect(treasurerSigner).serverTransferFundSingle(
                RANDOM_ADDRESS_3, [ {token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]
            )).wait()
            gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`gas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")} (sending native ETH)`)

        })

        it("serverPayout, sending native ETH", async() => {     
            let blockNumber = await ethers.provider.getBlockNumber();
            let receipt: ContractReceipt = await( await pool.connect(payouterSigner).serverPayout(
                RANDOM_ADDRESS_1, [{token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH")}], blockNumber + 1
            )).wait()

            let gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)


            blockNumber = await ethers.provider.getBlockNumber();
            receipt = await( await pool.connect(payouterSigner).serverPayout(
                RANDOM_ADDRESS_2, [{token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH")}], blockNumber + 1
            )).wait()
            gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`gas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")} (2nd transfer costs less)`)

        })

        it("serverTransferFund for 1 user with 1 token", async() => {
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(
                [RANDOM_ADDRESS_1], [[ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]]
            )).wait()

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)
        })

        it("serverTransferFund for 1 user with 2 tokens", async() => {
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(
                [RANDOM_ADDRESS_1], [[ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")}, {token: WSTETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]]
            )).wait()

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)
        })

        it("serverTransferFund for 1 user with 3 tokens", async() => {
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(
                [RANDOM_ADDRESS_1], [[ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")}, {token: WSTETH_ADDRESS, amount: parseTokenAmount("1", "ETH")}, {token: USDT_ADDRESS, amount: parseTokenAmount("0.12", "USDT")} ]]
            )).wait()

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)
        })

        it("serverTransferFund for 2 user with 1 token each", async() => {
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(
                [RANDOM_ADDRESS_1, RANDOM_ADDRESS_2], [[ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ], [ {token: WSTETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]]
            )).wait()

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)
        })

        it("serverTransferFund for 3 user with 1 token each", async() => {
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(
                [RANDOM_ADDRESS_1, RANDOM_ADDRESS_2, RANDOM_ADDRESS_3], 
                [[ {token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ], [ {token: WSTETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ], [ {token: WSTETH_ADDRESS, amount: parseTokenAmount("1", "ETH")} ]]
            )).wait()

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice)
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`)
        })

        it("serverTransferFund for 10 users with 1 token each", async() => {
            const { deployer, contractAdmin, treasurer,pauser, proposer, user0, user1 } = await getNamedAccounts();
            const addresses = [RANDOM_ADDRESS_1, RANDOM_ADDRESS_2, RANDOM_ADDRESS_3, deployer, contractAdmin, treasurer,pauser, proposer, user0, user1];
            const amounts = Array(10).fill([{ token: WETH_ADDRESS, amount: parseTokenAmount("1", "ETH") }]);
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(addresses, amounts)).wait();

            const gasFeeUsed = receipt.gasUsed.mul(ethGasPrice);
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")}`);
        })

        it("serverTransferFund for 100 users with 1 token each", async() => {
            let addressArr = [];
            for (let i = 0; i < 100; i++) {
                addressArr.push(ethers.Wallet.fromMnemonic("test test test test test test test test test test test junk", "m/44'/60'/0'/" + i.toString()).address)
            }
            let amounts = Array(100).fill([{ token: WETH_ADDRESS, amount: parseTokenAmount("0.01", "ETH") }]);
            let receipt: ContractReceipt = await( await pool.connect(treasurerSigner).serverTransferFund(addressArr, amounts, { gasLimit: 5000000 })).wait();
            let gasFeeUsed = receipt.gasUsed.mul(ethGasPrice);
            console.log(`\ngas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")} (sending WETH)`);
        
            amounts = Array(100).fill([{ token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("0.01", "ETH") }]);
            receipt = await( await pool.connect(treasurerSigner).serverTransferFund(addressArr, amounts, { gasLimit: 5000000 })).wait();
            gasFeeUsed = receipt.gasUsed.mul(ethGasPrice);
            console.log(`gas unit: ${receipt.gasUsed},  gas fee in ETH: ${formatTokenAmount(gasFeeUsed, "ETH")},  gas fee in USD: ${formatTokenAmount(gasFeeUsed.mul(ethMarketPriceInUsd), "ETH")} (sending native ETH)`);

        })
    });
});
