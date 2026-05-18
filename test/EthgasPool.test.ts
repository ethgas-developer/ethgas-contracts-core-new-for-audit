import { ethers, network, waffle, getNamedAccounts, deployments } from "hardhat";
import hre from "hardhat";
const { loadFixture } = waffle;
import { BigNumber, ContractReceipt, constants, Contract, ContractTransaction, errors } from 'ethers';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EthgasPool, ACLManager, IWETH, TestERC20, TimelockController} from '../typechain';
const {  DEFAULT_ADMIN_ROLE, TREASURER_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, TIMELOCK_ROLE, PAYOUTER_ROLE, NATIVE_ETH_ADDRESS } = require(`../helpers/constants`)
const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const tokensConfigObj = configObj['Tokens'];
const MIN_DELAY_SECS = configObj["TimelockControllerMinDelayInSecond"]
const addressObj = require(`../helpers/address/mainnet.json`);

const configObjWithETH = structuredClone(configObj);
const addressObjWithETH = structuredClone(addressObj);
const tokensConfigObjWithETH = configObjWithETH['Tokens'];
configObjWithETH["EthgasPoolSupportedTokens"].push("ETH");
addressObjWithETH["ETH"] = { "token_address": NATIVE_ETH_ADDRESS};
tokensConfigObjWithETH["ETH"] = { "daily_withdrawal_cap": 50 }

const WBTC_ADDRESS = addressObj["WBTC"]["token_address"];
const WSTETH_ADDRESS = addressObj["WSTETH"]["token_address"];
const WETH_ADDRESS = addressObj["WETH"]["token_address"];
const USDT_ADDRESS = addressObj["USDT"]["token_address"];
const RANDOM_ADDRESS_1 = addressObj["RANDOM"][0];
const RANDOM_ADDRESS_2 = addressObj["RANDOM"][1];
const RANDOM_ADDRESS_3 = addressObj["RANDOM"][2];
const { formatTokenAmount, parseTokenAmount} = require(`../helpers/utils`)
import { setTimeout } from "timers/promises";

import chaiAsPromised from 'chai-as-promised';
import chai from "chai";
import { ABI } from "hardhat-deploy/types";
import { Interface } from "ethers/lib/utils";
import { errorMonitor } from "events";
import func from "../deploy/001.ethgas-lib";
const { expect } = chai
chai.use(chaiAsPromised);

const MINT_AMOUNT = parseTokenAmount("100000000", "ETH");
const TOKEN_START_AMOUNT = parseTokenAmount("1", "ETH");


let supportedTokensArr: string[] = []
let dailyWithdrawalCapArr = []
for (let tokenName of configObj["EthgasPoolSupportedTokens"]) {
  dailyWithdrawalCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_withdrawal_cap.toString(), tokenName))
  supportedTokensArr.push(addressObj[tokenName]["token_address"])
}

describe("EthgasPool", () => {
  let deployerSigner: SignerWithAddress;
  let contractAdminSigner: SignerWithAddress;
  let pauserSigner: SignerWithAddress;
  let proposerSigner: SignerWithAddress;
  let userSigners: SignerWithAddress[];
  let treasurerAddress: string;
  let pool: EthgasPool;
  let poolInterface: Interface
  let poolAsBookkeeper: EthgasPool;
  let poolAsTreasurer: EthgasPool;
  let poolAsPayouter: EthgasPool;
  let aclManager: ACLManager;
  let timelockCtrl: TimelockController;
  let wethToken: IWETH;
  let tokenA: TestERC20;
  let tokenB: TestERC20;
  let tokenC: TestERC20;
  let tokens: TestERC20[] = [];


  const fixture = async ()=>{
    const { deployer, contractAdmin, treasurer, pauser, proposer, bookKeeper, payouter, user0, user1, user2, user3 } = await getNamedAccounts();
    
    deployerSigner = await ethers.getSigner(deployer);
    contractAdminSigner = await ethers.getSigner(contractAdmin);
    pauserSigner = await ethers.getSigner(pauser);
    proposerSigner = await ethers.getSigner(proposer);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];

    await deployments.fixture(['EthgasSetup','EthgasPool']);
    const poolDeploy = await deployments.get('EthgasPool');

    poolInterface = new ethers.utils.Interface(poolDeploy.abi);
    pool = await ethers.getContractAt(poolDeploy.abi, poolDeploy.address, contractAdminSigner) as EthgasPool;
    poolAsTreasurer = pool.connect(await ethers.getSigner(treasurer));
    poolAsPayouter = pool.connect(await ethers.getSigner(payouter));
    poolAsBookkeeper = pool.connect(await ethers.getSigner(bookKeeper));
    const timelockCtrlDeploy = await deployments.get('TimelockController');
    timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, contractAdminSigner) as TimelockController;
    await network.provider.request({method:"hardhat_impersonateAccount", params:[timelockCtrl.address]});
    await network.provider.request({method:"hardhat_setBalance", params:[timelockCtrl.address, ethers.utils.hexStripZeros(ethers.utils.parseEther("0.01").toHexString())]});
    const aclManagerDeploy = await deployments.get('ACLManager');
    aclManager = await ethers.getContractAt('ACLManager', aclManagerDeploy.address, contractAdminSigner) as ACLManager;

    wethToken = await ethers.getContractAt("IWETH",WETH_ADDRESS) as IWETH;
    tokenA = await (await ethers.getContractFactory("TestERC20")).deploy(MINT_AMOUNT) as TestERC20;
    tokenB = await (await ethers.getContractFactory("TestERC20")).deploy(MINT_AMOUNT) as TestERC20;
    tokenC = await (await ethers.getContractFactory("TestERC20")).deploy(MINT_AMOUNT) as TestERC20;
    tokens = [];
    for(let i=0;i<5;i++){
      tokens[i] = await (await ethers.getContractFactory("TestERC20")).deploy(MINT_AMOUNT) as TestERC20;
    }
    await setDailyTransferCapByAdmin("setDailyWithdrawalCap", tokenA.address, ethers.utils.parseEther("1000000000"));
    await poolAsBookkeeper.setSupportedToken(tokenA.address, true);
  }
  beforeEach('load fixture', async()=>{
    await loadFixture(fixture);
    // await wethToken.mint(userSigners[0].address,TOKEN_START_AMOUNT);
    await tokenA.mint(userSigners[0].address,TOKEN_START_AMOUNT);
    await tokenB.mint(userSigners[0].address,TOKEN_START_AMOUNT);
    await tokenC.mint(userSigners[0].address,TOKEN_START_AMOUNT);
    // await wethToken.mint(userSigners[1].address,TOKEN_START_AMOUNT);
    await tokenA.mint(userSigners[1].address,TOKEN_START_AMOUNT);
    await tokenB.mint(userSigners[1].address,TOKEN_START_AMOUNT);
    await tokenC.mint(userSigners[1].address,TOKEN_START_AMOUNT);
    
  });

  async function setStartingState(
    pool: EthgasPool, userSigners: SignerWithAddress[], 
    wethToken: IWETH, tokenA: TestERC20, tokenB: TestERC20, tokenC: TestERC20,
  ){

    await network.provider.request({method:"hardhat_setBalance",params:[userSigners[0].address,ethers.utils.hexStripZeros(TOKEN_START_AMOUNT.mul(2).toHexString())]});
    await pool.connect(userSigners[0]).deposit([],{value: TOKEN_START_AMOUNT});
    await tokenA.mint(pool.address,TOKEN_START_AMOUNT);
    await tokenB.mint(pool.address,TOKEN_START_AMOUNT);
    await tokenC.mint(pool.address,TOKEN_START_AMOUNT);
    expect(await waffle.provider.getBalance(pool.address)).to.equal(TOKEN_START_AMOUNT);
    expect(await tokenA.balanceOf(pool.address)).to.equal(TOKEN_START_AMOUNT);
    expect(await tokenB.balanceOf(pool.address)).to.equal(TOKEN_START_AMOUNT);
    expect(await tokenC.balanceOf(pool.address)).to.equal(TOKEN_START_AMOUNT);
  };

  async function setDailyTransferCapByAdmin(functionName: string, tokenAddress: string, cap: BigNumber) {
    // let encodedData: string = poolInterface.encodeFunctionData(functionName, [ tokenAddress, cap ]);
    // await (await timelockCtrl.connect(proposerSigner).schedule(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)).wait();
    // await network.provider.request({method:"evm_increaseTime",params:[ MIN_DELAY_SECS ]});
    // await network.provider.request({method:"evm_mine",params:[ ]});
    // await (await timelockCtrl.connect(contractAdminSigner).execute(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero)).wait();
    if (functionName === "setDailyPayoutCap") {
      await (await pool.connect(contractAdminSigner).setDailyPayoutCap(tokenAddress, cap)).wait()
    } else if (functionName === "setDailyWithdrawalCap") {
      await (await pool.connect(contractAdminSigner).setDailyWithdrawalCap(tokenAddress, cap)).wait()
    }
    
  }

  async function tokenBalance(tokenName: string, userAddress: string) {
    if (tokenName === "ETH") {
      return (await ethers.provider.getBalance(userAddress));
    } else {
      const erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', addressObj[tokenName]["token_address"]);
      return (await erc20Contract.balanceOf(userAddress));
    }
  }

  describe('access control', () => {
    it('fails if caller is not admin', async () => {
      await expect(aclManager.connect(userSigners[0]).grantRole(DEFAULT_ADMIN_ROLE, userSigners[1].address)).to.be.revertedWith('AccessControl')
    })

    it('updates admin', async () => {
      await expect(aclManager.grantRole(DEFAULT_ADMIN_ROLE, userSigners[0].address))
        .to.emit(aclManager, 'RoleGranted')
      expect(await aclManager.hasRole(DEFAULT_ADMIN_ROLE, userSigners[0].address)).to.eq(true)
      await aclManager.connect(userSigners[0]).grantRole(DEFAULT_ADMIN_ROLE, userSigners[1].address)
    })

    it('deployer is NOT admin', async () => {
      expect(await aclManager.hasRole(DEFAULT_ADMIN_ROLE, deployerSigner.address)).to.be.false;
    });

    it('normal user cannot call serverPayout', async () => {
      const TREASURER_REVERT_STRING = "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + PAYOUTER_ROLE
      await expect(
        pool.connect(userSigners[0]).serverPayout(userSigners[0].address, [{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}], await ethers.provider.getBlockNumber() + 1)
      ).to.be.revertedWith(TREASURER_REVERT_STRING);
    });

    it('normal user cannot call serverTransferFundSingle', async () => {
      const TREASURER_REVERT_STRING = "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TREASURER_ROLE
      await expect(
        pool.connect(userSigners[0]).serverTransferFundSingle(userSigners[0].address, [{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}])
      ).to.be.revertedWith(TREASURER_REVERT_STRING);
    });

    it('normal user cannot call serverTransferFund', async () => {
      const TREASURER_REVERT_STRING = "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TREASURER_ROLE
      await expect(
        pool.connect(userSigners[0]).serverTransferFund([userSigners[0].address], [[{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}]])
      ).to.be.revertedWith(TREASURER_REVERT_STRING);
    });

    it('normal user cannot call serverTransferAnyFund', async () => {
      const TIMELOCK_REVERT_STRING = "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      await expect(
        pool.connect(userSigners[0]).serverTransferAnyFund([userSigners[0].address], [[{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}]])
      ).to.be.revertedWith(TIMELOCK_REVERT_STRING);
    });

    it('treasurer cannot call serverTransferAnyFund', async () => {
      let { treasurer } = await getNamedAccounts();
      const TIMELOCK_REVERT_STRING = "AccessControl: account " + treasurer.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      await expect(
        poolAsTreasurer.serverTransferAnyFund([userSigners[0].address], [[{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}]])
      ).to.be.revertedWith(TIMELOCK_REVERT_STRING);
    });

    it('admin can update daily withdrawal cap', async () => {
      expect(await pool.dailyWithdrawalCap(WETH_ADDRESS)).to.eq(parseTokenAmount(tokensConfigObj["WETH"].daily_withdrawal_cap.toString(), "WETH"));
      await setDailyTransferCapByAdmin("setDailyWithdrawalCap", WETH_ADDRESS, parseTokenAmount("72.5", "WETH"));
      expect(await pool.dailyWithdrawalCap(WETH_ADDRESS)).to.eq(parseTokenAmount("72.5", "WETH"));
    });

    it('admin can update daily payout cap', async () => {
      expect(await pool.dailyPayoutCap(WETH_ADDRESS)).to.eq(parseTokenAmount(tokensConfigObj["WETH"].daily_payout_cap.toString(), "WETH"));
      await setDailyTransferCapByAdmin("setDailyPayoutCap", WETH_ADDRESS, parseTokenAmount("100.1", "WETH"));
      expect(await pool.dailyPayoutCap(WETH_ADDRESS)).to.eq(parseTokenAmount("100.1", "WETH"));
    });

    it('non-admin cannot update daily withdrawal cap', async () => {
      let { treasurer } = await getNamedAccounts();
      const ADMIN_REVERT_STRING = "AccessControl: account " + treasurer.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      await expect(poolAsTreasurer.setDailyWithdrawalCap(WETH_ADDRESS, parseTokenAmount("50", "WETH"))).to.be.revertedWith(ADMIN_REVERT_STRING)
    });

    it('non-admin cannot update daily payout cap', async () => {
      let { payouter } = await getNamedAccounts();
      const ADMIN_REVERT_STRING = "AccessControl: account " + payouter.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      await expect(poolAsPayouter.setDailyPayoutCap(WETH_ADDRESS, parseTokenAmount("500", "WETH"))).to.be.revertedWith(ADMIN_REVERT_STRING)
    });


  })

  describe('Timelock controlled functions', () => {
    it('timelock can update ACLManager address', async () => {
      let { deployer, contractAdmin, pauser, proposer, treasurer, bookKeeper, payouter } = await getNamedAccounts();
      const { deploy } = deployments;
      let timelockCtrlDeploy = await deployments.get('TimelockController');
      const newACLManager = await deploy('ACLManagerNew', { 
        from: deployer, log: true, autoMine: true,
        contract: 'ACLManager',
        args: [ contractAdmin, treasurer, timelockCtrlDeploy.address, [ pauser ], bookKeeper, payouter ],
      });

      expect(await pool.aclManager()).to.eq(aclManager.address);
      await (await timelockCtrl.connect(proposerSigner).schedule(
        pool.address, 0, poolInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        pool.address, 0, poolInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      expect(await pool.aclManager()).to.eq(newACLManager.address);
    });

    it('non-timelock cannot update ACLManager address', async () => {
      let { deployer, contractAdmin, pauser, proposer, treasurer, bookKeeper, payouter } = await getNamedAccounts();
      const { deploy } = deployments;
      let timelockCtrlDeploy = await deployments.get('TimelockController');
      const newACLManager = await deploy('ACLManagerNewNT', { 
        from: deployer, log: true, autoMine: true,
        contract: 'ACLManager',
        args: [ contractAdmin, treasurer, timelockCtrlDeploy.address, [ pauser ], bookKeeper, payouter ],
      });
      const TIMELOCK_REVERT_STRING = "AccessControl: account " + treasurer.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      await expect(poolAsTreasurer.setAclManager(newACLManager.address)).to.be.revertedWith(TIMELOCK_REVERT_STRING)
    });

  });

  describe('Switch Supported Token List', () => {
    it('updates supported Tokens address', async () => {
      for (let i = 0; i < supportedTokensArr.length -1; i++) {
        expect(await pool.supportedToken(supportedTokensArr[i])).to.eq(true);
      }
      
      let newTokensArr = [
        wethToken.address,
        tokenA.address,
        tokenB.address,
      ];
      let newTokenSupportArr = [ false, true, true ]

      
      for (let i = 0; i < newTokensArr.length -1; i++) {
        await poolAsBookkeeper.setSupportedToken(newTokensArr[i], newTokenSupportArr[i]);
      }

      for (let i = 0; i < newTokensArr.length -1; i++) {
        expect(await pool.supportedToken(newTokensArr[i])).to.eq(newTokenSupportArr[i]);
      }

      await expect(pool.connect(userSigners[0]).deposit(
        []
        ,{value: 1}
      )).to.be.revertedWith("NotSupportedToken")
      
    });
  });

  describe("Deposits", ()=>{
    it("checks account balances",async()=>{
      expect(await tokenA.balanceOf(userSigners[0].address)).to.equal(TOKEN_START_AMOUNT);
      expect(await tokenB.balanceOf(userSigners[0].address)).to.equal(TOKEN_START_AMOUNT);
      expect(await tokenC.balanceOf(userSigners[0].address)).to.equal(TOKEN_START_AMOUNT);
      expect(await tokenA.balanceOf(userSigners[1].address)).to.equal(TOKEN_START_AMOUNT);
      expect(await tokenB.balanceOf(userSigners[1].address)).to.equal(TOKEN_START_AMOUNT);
      expect(await tokenC.balanceOf(userSigners[1].address)).to.equal(TOKEN_START_AMOUNT);
    });

    it("deposits WETH, native ETH & tokens",async()=>{
      const TRANSFER_AMOUNT_ETHER = BigNumber.from(4*1e4);
      const TRANSFER_AMOUNT_WETH = ethers.utils.parseEther("1.5")
      const TRANSFER_AMOUNT_TOKEN = BigNumber.from(2).pow(8);
      const poolWETHBalance = await wethToken.balanceOf(pool.address);
      const poolEthBalance = await ethers.provider.getBalance(pool.address);
      await wethToken.connect(userSigners[0]).deposit({value: TRANSFER_AMOUNT_WETH})
      await wethToken.connect(userSigners[0]).approve(pool.address,TRANSFER_AMOUNT_WETH);
      const approvalTx = await tokenA.connect(userSigners[0]).approve(pool.address,TRANSFER_AMOUNT_TOKEN);
      expect(approvalTx).to.emit(tokenA,'Approval').withArgs(userSigners[0].address,pool.address,TRANSFER_AMOUNT_TOKEN);
      const approvalReceipt = await approvalTx.wait();
      const userEtherBalance = await waffle.provider.getBalance(userSigners[0].address);
      const receipt:ContractReceipt = await (
        await pool.connect(userSigners[0]).deposit(
          [{token:tokenA.address,amount:TRANSFER_AMOUNT_TOKEN}, {token: WETH_ADDRESS,amount: TRANSFER_AMOUNT_WETH}],
          {value: TRANSFER_AMOUNT_ETHER}
        )
      ).wait();
      
      const event = receipt.events?.filter((x) => {return x.event == "DepositsTriggered"})[0];
      
      expect(event?.args).to.deep.equal([
        userSigners[0].address,
        [[tokenA.address,TRANSFER_AMOUNT_TOKEN],[WETH_ADDRESS, TRANSFER_AMOUNT_WETH],[NATIVE_ETH_ADDRESS,TRANSFER_AMOUNT_ETHER]]
      ]);
      
      
      const gasFeeUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice)
      expect(await tokenA.balanceOf(pool.address)).to.equal(TRANSFER_AMOUNT_TOKEN);
      expect(await tokenA.balanceOf(userSigners[0].address)).to.equal(TOKEN_START_AMOUNT.sub(TRANSFER_AMOUNT_TOKEN));
      expect(await wethToken.balanceOf(pool.address)).to.equal(poolWETHBalance.add(TRANSFER_AMOUNT_WETH));
      expect(await ethers.provider.getBalance(pool.address)).to.equal(poolEthBalance.add(TRANSFER_AMOUNT_ETHER));
      expect(await ethers.provider.getBalance(userSigners[0].address)).to.equal(BigNumber.from(userEtherBalance).sub(TRANSFER_AMOUNT_ETHER).sub(gasFeeUsed));
    });

    it("deposits tokens only",async()=>{
      const TRANSFER_AMOUNT_TOKEN = BigNumber.from(2).pow(8);
      await expect(tokenA.connect(userSigners[0]).approve(pool.address,TRANSFER_AMOUNT_TOKEN)).to.emit(tokenA,'Approval');
      const receipt:ContractReceipt = await (
        await pool.connect(userSigners[0]).deposit(
          [{token:tokenA.address,amount:TRANSFER_AMOUNT_TOKEN}]
        )
      ).wait();
      const event = receipt.events?.filter((x) => {return x.event == "DepositsTriggered"})[0];
      
      expect(event?.args).to.deep.equal([
        userSigners[0].address,
        [[tokenA.address,TRANSFER_AMOUNT_TOKEN]]
      ]);
      expect(await tokenA.balanceOf(pool.address)).to.equal(TRANSFER_AMOUNT_TOKEN);
    });

    it("deposits WETH only",async()=>{
      expect(await wethToken.balanceOf(pool.address)).to.equal(0);
      const TRANSFER_AMOUNT_TOKEN = ethers.utils.parseEther("2.2");
      await wethToken.connect(userSigners[0]).deposit({value: TRANSFER_AMOUNT_TOKEN})
      await wethToken.connect(userSigners[0]).approve(pool.address, TRANSFER_AMOUNT_TOKEN)
      const receipt:ContractReceipt = await (
        await pool.connect(userSigners[0]).deposit(
          [{token: WETH_ADDRESS, amount:TRANSFER_AMOUNT_TOKEN}]
        )
      ).wait();
      const event = receipt.events?.filter((x) => {return x.event == "DepositsTriggered"})[0];
      
      expect(event?.args).to.deep.equal([
        userSigners[0].address,
        [[WETH_ADDRESS,TRANSFER_AMOUNT_TOKEN]]
      ]);
      expect(await wethToken.balanceOf(pool.address)).to.equal(TRANSFER_AMOUNT_TOKEN);
    });

    it("deposits tokens: native ETH only",async()=>{
      const startAmount = await ethers.provider.getBalance(pool.address);
      const TRANSFER_AMOUNT_ETHER = BigNumber.from(10).pow(18);
      const receipt:ContractReceipt = await (
        await pool.connect(userSigners[0]).deposit(
          []
          ,{value: TRANSFER_AMOUNT_ETHER}
        )
      ).wait();
      const event = receipt.events?.filter((x) => {return x.event == "DepositsTriggered"})[0];
      expect(event?.args).to.deep.equal([
        userSigners[0].address,
        [[NATIVE_ETH_ADDRESS,TRANSFER_AMOUNT_ETHER]]
      ]);
      expect(await ethers.provider.getBalance(pool.address)).to.equal(BigNumber.from(startAmount).add(TRANSFER_AMOUNT_ETHER));
    });

    it("deposits tokens: no approval",async()=>{
      const TRANSFER_AMOUNT_TOKEN = TOKEN_START_AMOUNT;
      await expect(pool.connect(userSigners[0]).deposit(
        [{token:tokenA.address,amount:TRANSFER_AMOUNT_TOKEN}],{value: BigNumber.from(0)}
      )).to.be.revertedWith('ERC20InsufficientAllowance');
    });
    it("deposits tokens: insufficient token fail",async()=>{
      const TRANSFER_AMOUNT_TOKEN = TOKEN_START_AMOUNT;
      expect(await tokenA.connect(userSigners[0]).approve(pool.address,TRANSFER_AMOUNT_TOKEN)).to.emit(tokenA,'Approval');
      await expect(pool.connect(userSigners[0]).deposit(
        [{token:tokenA.address,amount:TRANSFER_AMOUNT_TOKEN.add(BigNumber.from(1))}],
        {value: BigNumber.from(0)}
      )).to.be.revertedWith('NotEnoughBalance');
    });
    it("deposit tokens: n + 1 failed deposit should cause no transfer for the first n token",async()=>{
      const TRANSFER_AMOUNT_TOKEN = TOKEN_START_AMOUNT;
      await (await tokenA.connect(userSigners[0]).approve(pool.address,TRANSFER_AMOUNT_TOKEN)).wait();
      
      await expect(pool.connect(userSigners[0]).deposit(
        [
          {token:tokenA.address,amount:TRANSFER_AMOUNT_TOKEN},
          {token:tokenB.address,amount:TRANSFER_AMOUNT_TOKEN} // tokenB is not approved, transfer will fail
        ]
        ,{value: BigNumber.from(0)}
      )).to.be.revertedWith("NotSupportedToken");

      expect(await tokenA.balanceOf(userSigners[0].address)).to.equal(TOKEN_START_AMOUNT);
    });
  });

  
  describe("serverTransferFund", ()=>{
    beforeEach("starting account",async ()=>{
      await setStartingState(pool, userSigners, wethToken, tokenA, tokenB, tokenC);
    });
    it("transfer token: fails with insufficient pool token",async()=>{
      
      await expect(
        poolAsTreasurer.serverTransferFund(
          [userSigners[0].address],
          [[{token:tokenA.address,amount:TOKEN_START_AMOUNT.add(1)}]]
        )
      ).to.be.revertedWith('ERC20InsufficientBalance');

      await expect(
        poolAsTreasurer.serverTransferFund(
          [userSigners[0].address],
          [[{token: NATIVE_ETH_ADDRESS, amount: TOKEN_START_AMOUNT.add(1)}]]
        )
      ).to.be.revertedWith('FailedToSendEth');
    });

    it("transfer token: fails with negative amount",async()=>{
      const TWO_TO_255 = BigNumber.from(2).pow(255);

      await (await (tokenA.mint(pool.address,TWO_TO_255))).wait();
      
      await expect(poolAsTreasurer.serverTransferFund(
        [userSigners[2].address],
        [[{token:tokenA.address,amount:constants.MinInt256}]]
      )).to.be.rejectedWith("value out-of-bounds");
    });
  });




  describe("Sending ETH to EthgasPool", () => {
    it("anyone can directly send ETH to EthgasPool", async () => {
      const ETH_INIT_BALANCE = await ethers.provider.getBalance(pool.address);
      expect(await deployerSigner.getBalance()).to.gt(ethers.utils.parseEther("1"))
      await deployerSigner.sendTransaction({ value: ethers.utils.parseEther("1"), to: pool.address })
      const ETH_ENDING_BALANCE = await ethers.provider.getBalance(pool.address);
      expect(ETH_ENDING_BALANCE).to.eq(ETH_INIT_BALANCE.add(ethers.utils.parseEther("1")));
    })

    it("anyone can directly send WETH to EthgasPool", async () => {
      const WETH_POOL_INIT_BALANCE = await tokenBalance("WETH", pool.address);
      const SEND_AMOUNT = ethers.utils.parseEther("1.2")
      await wethToken.connect(userSigners[0]).deposit({value: SEND_AMOUNT})
      const WETH_USER_INIT_BALANCE = await tokenBalance("WETH", userSigners[0].address);
      await wethToken.connect(userSigners[0]).transfer(pool.address, SEND_AMOUNT)
      const WETH_POOL_END_BALANCE = await tokenBalance("WETH", pool.address);
      const WETH_USER_END_BALANCE = await tokenBalance("WETH", userSigners[0].address);
      expect(WETH_POOL_END_BALANCE).to.eq(WETH_POOL_INIT_BALANCE.add(SEND_AMOUNT));
      expect(WETH_USER_END_BALANCE).to.eq(WETH_USER_INIT_BALANCE.sub(SEND_AMOUNT));
    })
  })

  describe("serverTransferFund", ()=>{
    beforeEach("before", async() => {

      let walletAddress: string;
      let walletSigner: SignerWithAddress;
      let tokenAddress: string;
      let sendAmount: BigNumber;
      let erc20Contract: Contract;




      for (let tokenName of configObjWithETH["EthgasPoolSupportedTokens"]) {
        if (tokenName === "ETH") {
          await network.provider.request({method:"hardhat_setBalance", params:[pool.address, ethers.utils.hexStripZeros(ethers.utils.parseEther("1000").toHexString())]});
          continue;
        }
        walletAddress = addressObj[tokenName]["impersonate_holder_address"];
        tokenAddress = addressObj[tokenName]["token_address"];
        sendAmount = parseTokenAmount(tokensConfigObj[tokenName]["test_fund_transfer_amount"].toString(), tokenName.toString());
        await network.provider.request({method: "hardhat_impersonateAccount", params: [ walletAddress ]});
        walletSigner = await ethers.getSigner(walletAddress);
        erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', tokenAddress, walletSigner);
        const userEndBalance: BigNumber = await erc20Contract.balanceOf(walletAddress);
        await ( await erc20Contract.approve(pool.address, sendAmount) ).wait();
        await (
          await pool.connect(walletSigner).deposit(
            [ {token: tokenAddress, amount: sendAmount } ]
          )
        ).wait()
      }
    });

    for (let tokenName of configObjWithETH["EthgasPoolSupportedTokens"]) {
      it(`Can transfer ${tokenName} with amount equal to daily withdrawal cap`, async () => {

          const userAddress = RANDOM_ADDRESS_1;
          const userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
          let sendAmount: BigNumber = parseTokenAmount((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]).toString(), tokenName);
          let receipt: ContractReceipt = await( await poolAsTreasurer.serverTransferFund(
            [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
          ) ).wait();
          const userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
          if (tokenName.toUpperCase === "STETH" || tokenName.toUpperCase().slice(0, 1) === "A") {
            expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
          } else {
            expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
          }
      })

      it(`Can transfer ${tokenName} with amount equal to daily withdrawal cap using serverTransferFundSingle`, async () => {
        const userAddress = RANDOM_ADDRESS_1;
        const userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        let sendAmount: BigNumber = parseTokenAmount((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]).toString(), tokenName);
        let receipt: ContractReceipt = await( await poolAsTreasurer.serverTransferFundSingle(
          userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]
        ) ).wait();
        const userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        if (tokenName.toUpperCase() === "STETH" || tokenName.toUpperCase().slice(0, 1) === "A") {
          expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
        } else {
          expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
        }
      })

      it(`Can transfer ${tokenName} to multple clients with one function call`, async() => 
        {
          const userAddress1 = RANDOM_ADDRESS_1;
          const userAddress2 = RANDOM_ADDRESS_2;
          const userAddress3 = RANDOM_ADDRESS_3;
          const userStartBalance1: BigNumber = await tokenBalance(tokenName, userAddress1);
          const userStartBalance2: BigNumber = await tokenBalance(tokenName, userAddress2);
          const userStartBalance3: BigNumber = await tokenBalance(tokenName, userAddress3);
          let sendAmount: BigNumber = parseTokenAmount((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]).toString(), tokenName).div(3);
          let receipt: ContractReceipt = await( await poolAsTreasurer.serverTransferFund(
            [userAddress1, userAddress2, userAddress3], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
          ) ).wait();
          //let event = receipt.events?.filter((x) => {return x.event == "Withdrawal"})[0];
          const userEndBalance1: BigNumber = await tokenBalance(tokenName, userAddress1);
          const userEndBalance2: BigNumber = await tokenBalance(tokenName, userAddress2);
          const userEndBalance3: BigNumber = await tokenBalance(tokenName, userAddress3);
          //expect(event?.args?.isCompleted).to.eq(true);
          if (tokenName.toUpperCase() === "STETH" || tokenName.toUpperCase().slice(0, 1) === "A") {
            expect(userEndBalance1.sub(userStartBalance1.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
            expect(userEndBalance2.sub(userStartBalance2.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
            expect(userEndBalance3.sub(userStartBalance3.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
          } else {
            //expect(userEndBalance).to.eq(userStartBalance.add(sendAmount));
            expect(userEndBalance1.sub(userStartBalance1.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
            expect(userEndBalance2.sub(userStartBalance2.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
            expect(userEndBalance3.sub(userStartBalance3.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
          }
        })
      
      it(`Can transfer ${tokenName} a day later after hitting daily withdrawal cap`, async () => {
        const userAddress = RANDOM_ADDRESS_1;
        const userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        let sendAmount: BigNumber = parseTokenAmount((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]).toString(), tokenName.toString().toUpperCase());
        // 1st transfer succeed
        await( await poolAsTreasurer.serverTransferFund(
          [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
        ) ).wait();
        const userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        if (tokenName.toUpperCase() === "STETH" || tokenName.toUpperCase().slice(0, 1) === "A") {
          expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.lt(2); // few wei error for STETH (due to division)
        } else {
          expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0); 
        }
        // 2nd transfer fail
        await expect(poolAsTreasurer.serverTransferFund(
          [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: 1} ]]
        ) ).to.be.revertedWith("ExceedDailyTransferCap")

        await network.provider.request({method:"evm_increaseTime", params:[ 86400 - 10 ]});
        await network.provider.request({method:"evm_mine", params:[ ]});

        // 3rd transfer fail 10 seconds before reset limit
        await expect(poolAsTreasurer.serverTransferFund(
          [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: 1} ]]
        ) ).to.be.revertedWith("ExceedDailyTransferCap")

        await network.provider.request({method:"evm_increaseTime", params:[ 10 ]});
        await network.provider.request({method:"evm_mine", params:[ ]});

        let eventTokenName = tokenName;
        if (tokenName === "ETH") {
          eventTokenName = "WETH";
        }
        // 4th transfer succeed
        await expect(
          poolAsTreasurer.serverTransferFund(
          [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
        ) 
        ).to.emit(poolAsTreasurer, "Withdrawal").withArgs(userAddress, [addressObjWithETH[eventTokenName]["token_address"], sendAmount])

      })
    }

    it("Can transfer native ETH then ERC20 token with correct events and amounts", async () => {
      const userAddress = RANDOM_ADDRESS_1;
      const ethAmount = parseTokenAmount("0.25", "ETH");
      const usdtAmount = parseTokenAmount("12.345678", "USDT");

      const userEthStartBalance: BigNumber = await tokenBalance("ETH", userAddress);
      const userUsdtStartBalance: BigNumber = await tokenBalance("USDT", userAddress);
      const poolEthStartBalance: BigNumber = await tokenBalance("ETH", pool.address);
      const poolUsdtStartBalance: BigNumber = await tokenBalance("USDT", pool.address);

      const receipt: ContractReceipt = await (await poolAsTreasurer.serverTransferFund(
        [userAddress],
        [[
          {token: NATIVE_ETH_ADDRESS, amount: ethAmount},
          {token: USDT_ADDRESS, amount: usdtAmount},
        ]]
      )).wait();

      const withdrawalEvents = receipt.events?.filter((event) => event.event === "Withdrawal") ?? [];
      expect(withdrawalEvents.length).to.eq(2);
      expect(withdrawalEvents[0].args?.clientAddress).to.eq(userAddress);
      expect(withdrawalEvents[0].args?.tokenTranfer.token).to.eq(WETH_ADDRESS);
      expect(withdrawalEvents[0].args?.tokenTranfer.amount).to.eq(ethAmount);
      expect(withdrawalEvents[1].args?.clientAddress).to.eq(userAddress);
      expect(withdrawalEvents[1].args?.tokenTranfer.token).to.eq(USDT_ADDRESS);
      expect(withdrawalEvents[1].args?.tokenTranfer.amount).to.eq(usdtAmount);

      const userEthEndBalance: BigNumber = await tokenBalance("ETH", userAddress);
      const userUsdtEndBalance: BigNumber = await tokenBalance("USDT", userAddress);
      const poolEthEndBalance: BigNumber = await tokenBalance("ETH", pool.address);
      const poolUsdtEndBalance: BigNumber = await tokenBalance("USDT", pool.address);
      expect(userEthEndBalance.sub(userEthStartBalance)).to.eq(ethAmount);
      expect(userUsdtEndBalance.sub(userUsdtStartBalance)).to.eq(usdtAmount);
      expect(poolEthStartBalance.sub(poolEthEndBalance)).to.eq(ethAmount);
      expect(poolUsdtStartBalance.sub(poolUsdtEndBalance)).to.eq(usdtAmount);
    })

    it(`ETH & WETH share same daily withdrawal cap: Can transfer ETH & WETH a day later after hitting daily withdrawal cap`, async () => {
      const userAddress = RANDOM_ADDRESS_1;
      let tokenName = "WETH";
      let userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      let sendAmount: BigNumber = parseTokenAmount(((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]) / 2).toString(), tokenName.toString().toUpperCase());
      // 1st transfer succeed
      await( await poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
      ) ).wait();
      let userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0);
      // 2nd transfer succeed
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0);

      await network.provider.request({method:"evm_increaseTime", params:[ 86400 - 10 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      // 3rd transfer fail 10 seconds before reset limit
      tokenName = "ETH";
      await expect(poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: 1} ]]
      ) ).to.be.revertedWith("ExceedDailyTransferCap")

      tokenName = "WETH";
      await expect(poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: 1} ]]
      ) ).to.be.revertedWith("ExceedDailyTransferCap")

      await network.provider.request({method:"evm_increaseTime", params:[ 10 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      let eventTokenName = "WETH";
      // 4th transfer succeed
      tokenName = "ETH";
      await expect(
        poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
      ) 
      ).to.emit(poolAsTreasurer, "Withdrawal").withArgs(userAddress, [addressObjWithETH[eventTokenName]["token_address"], sendAmount])

      // 5th transfer succeed
      tokenName = "WETH";
      await expect(
        poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
      ) 
      ).to.emit(poolAsTreasurer, "Withdrawal").withArgs(userAddress, [addressObjWithETH[eventTokenName]["token_address"], sendAmount])

    })

    it(`serverTransferFund and serverPayout share different daily cap`, async () => {
      let tokenName = "WETH";
      let dailyWithdrawalCap: BigNumber = parseTokenAmount(((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"])).toString(), tokenName.toString().toUpperCase());
      let dailyPayoutCap: BigNumber = parseTokenAmount(((tokensConfigObjWithETH[tokenName]["daily_payout_cap"])).toString(), tokenName.toString().toUpperCase());
      
      // 1st serverTransferFund succeed
      let userAddress = RANDOM_ADDRESS_1;
      let userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      await( await poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyWithdrawalCap} ]]
      ) ).wait();
      let userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(dailyWithdrawalCap))).to.eq(0);
      
      // 2nd serverTransferFund fail
      userAddress = RANDOM_ADDRESS_2;
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await expect(poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyWithdrawalCap} ]]
      ) ).to.be.revertedWith("ExceedDailyTransferCap")
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance)).to.eq(0);

      await network.provider.request({method:"evm_increaseTime", params:[ 3600 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      // 1st serverPayout succeed
      let blockNumber = await ethers.provider.getBlockNumber();
      userAddress = RANDOM_ADDRESS_2;
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyPayoutCap} ], blockNumber + 2
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(dailyPayoutCap))).to.eq(0);

      // 2nd serverPayout fail
      blockNumber = await ethers.provider.getBlockNumber();
      userAddress = RANDOM_ADDRESS_3;
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyPayoutCap} ], blockNumber + 2
      ) ).to.be.revertedWith("ExceedDailyTransferCap")
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance)).to.eq(0);


      await network.provider.request({method:"evm_increaseTime", params:[ 86400 - 3600 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});
      
      // 3rd serverTransferFund succeed after resetting daily cap
      userAddress = RANDOM_ADDRESS_3;
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsTreasurer.serverTransferFund(
        [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyWithdrawalCap} ]]
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(dailyWithdrawalCap))).to.eq(0);

      // 3rd serverPayout fail
      blockNumber = await ethers.provider.getBlockNumber();
      userAddress = RANDOM_ADDRESS_3;
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyPayoutCap} ], blockNumber + 2
      ) ).to.be.revertedWith("ExceedDailyTransferCap")
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance)).to.eq(0);

      await network.provider.request({method:"evm_increaseTime", params:[ 3600 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});
      
      // 4th serverPayout succeed
      blockNumber = await ethers.provider.getBlockNumber();
      userAddress = RANDOM_ADDRESS_2;
      tokenName = "WETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: dailyPayoutCap} ], blockNumber + 2
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(dailyPayoutCap))).to.eq(0);

    })

    it("can serverPayout in ETH or WETH in targeted block number", async () => {
      const userAddress = RANDOM_ADDRESS_2;
      let blockNumber = await ethers.provider.getBlockNumber();
      let tokenName = "ETH";
      let userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      let sendAmount: BigNumber = parseTokenAmount("0.01", tokenName.toString().toUpperCase());
      await( await poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 1
      ) ).wait();
      let userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0);


      blockNumber = await ethers.provider.getBlockNumber();
      tokenName = "WETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 1
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0);


      blockNumber = await ethers.provider.getBlockNumber();
      tokenName = "ETH";
      userStartBalance = await tokenBalance(tokenName, userAddress);
      await( await poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 2
      ) ).wait();
      userEndBalance = await tokenBalance(tokenName, userAddress);
      expect(userEndBalance.sub(userStartBalance.add(sendAmount))).to.eq(0);
    });

    it("cannot serverPayout out of targeted block number", async () => {
      const userAddress = RANDOM_ADDRESS_3;
      let blockNumber = await ethers.provider.getBlockNumber();
      let tokenName = "ETH";
      let sendAmount: BigNumber = parseTokenAmount("0.01", tokenName.toString().toUpperCase());
      for (let i = 0; i < 2; i++) {
        await network.provider.request({method:"evm_mine", params:[ ]});
      }
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 2
      )).to.be.revertedWith('InvalidBlockNumber()');

      blockNumber = await ethers.provider.getBlockNumber();
      for (let i = 0; i < 64; i++) {
        await network.provider.request({method:"evm_mine", params:[ ]});
      }
      tokenName = "ETH";
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 64
      )).to.be.revertedWith('InvalidBlockNumber()');

      blockNumber = await ethers.provider.getBlockNumber();
      tokenName = "ETH";
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber - 1
      )).to.be.revertedWith('InvalidBlockNumber()');

      blockNumber = await ethers.provider.getBlockNumber();
      for (let i = 0; i < 3; i++) {
        await network.provider.request({method:"evm_mine", params:[ ]});
      }
      tokenName = "WETH";
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 3
      )).to.be.revertedWith('InvalidBlockNumber()');

      blockNumber = await ethers.provider.getBlockNumber();
      for (let i = 0; i < 1; i++) {
        await network.provider.request({method:"evm_mine", params:[ ]});
      }
      tokenName = "WETH";
      await expect(poolAsPayouter.serverPayout(
        userAddress, [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], blockNumber + 1
      )).to.be.revertedWith('InvalidBlockNumber()');
    });

    it(`Can transfer different tokens to multple clients within one function call`, async() => 
      {
        const userAddress1 = RANDOM_ADDRESS_1;
        const userAddress2 = RANDOM_ADDRESS_2;
        const userAddress3 = RANDOM_ADDRESS_3;
        const wbtcContract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WBTC_ADDRESS);
        const stethContract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WSTETH_ADDRESS);
        const usdtContract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', USDT_ADDRESS);
        const user1WbtcStartBalance: BigNumber = await wbtcContract.balanceOf(userAddress1);
        const user1StethStartBalance: BigNumber = await stethContract.balanceOf(userAddress1);
        const user2UsdtStartBalance: BigNumber = await usdtContract.balanceOf(userAddress2);
        const user2StethStartBalance: BigNumber = await stethContract.balanceOf(userAddress2);
        const user3UsdtStartBalance: BigNumber = await usdtContract.balanceOf(userAddress3);
        const user3WbtcStartBalance: BigNumber = await wbtcContract.balanceOf(userAddress3);
        await( await poolAsTreasurer.serverTransferFund(
          [userAddress1, userAddress2, userAddress3], 
          [ 
            [ 
              {token: WBTC_ADDRESS, amount: parseTokenAmount((tokensConfigObj["WBTC"]["daily_withdrawal_cap"]).toString(), "WBTC").div(3)},
              {token: WSTETH_ADDRESS, amount: parseTokenAmount((tokensConfigObj["WSTETH"]["daily_withdrawal_cap"]).toString(), "WSTETH").div(3)}
            ], 
            [ 
              {token: WSTETH_ADDRESS, amount: parseTokenAmount((tokensConfigObj["WSTETH"]["daily_withdrawal_cap"]).toString(), "WSTETH").div(3)},
              {token: USDT_ADDRESS, amount: parseTokenAmount((tokensConfigObj["USDT"]["daily_withdrawal_cap"]).toString(), "USDT").div(3)}
            ], 
            [ 
              {token: WBTC_ADDRESS, amount: parseTokenAmount((tokensConfigObj["WBTC"]["daily_withdrawal_cap"]).toString(), "WBTC").div(3)},
              {token: USDT_ADDRESS, amount: parseTokenAmount((tokensConfigObj["USDT"]["daily_withdrawal_cap"]).toString(), "USDT").div(3)}
            ]
          ]
        ) ).wait();
        const user1WbtcEndBalance: BigNumber = await wbtcContract.balanceOf(userAddress1);
        const user1StethEndBalance: BigNumber = await stethContract.balanceOf(userAddress1);
        const user2UsdtEndBalance: BigNumber = await usdtContract.balanceOf(userAddress2);
        const user2StethEndBalance: BigNumber = await stethContract.balanceOf(userAddress2);
        const user3UsdtEndBalance: BigNumber = await usdtContract.balanceOf(userAddress3);
        const user3WbtcEndBalance: BigNumber = await wbtcContract.balanceOf(userAddress3);
        expect(user1WbtcEndBalance).to.gt(0);
        expect(user1StethEndBalance).to.gt(0);
        expect(user2UsdtEndBalance).to.gt(0);
        expect(user2StethEndBalance).to.gt(0);
        expect(user3UsdtEndBalance).to.gt(0);
        expect(user3WbtcEndBalance).to.gt(0);
        expect(user1WbtcEndBalance).to.eq(user1WbtcStartBalance.add(parseTokenAmount((tokensConfigObj["WBTC"]["daily_withdrawal_cap"]).toString(), "WBTC").div(3)));
        expect(user1StethEndBalance.sub(user1StethStartBalance.add(parseTokenAmount((tokensConfigObj["WSTETH"]["daily_withdrawal_cap"]).toString(), "WSTETH").div(3)))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
        expect(user2UsdtEndBalance).to.eq(user2UsdtStartBalance.add(parseTokenAmount((tokensConfigObj["USDT"]["daily_withdrawal_cap"]).toString(), "USDT").div(3)));
        expect(user2StethEndBalance.sub(user2StethStartBalance.add(parseTokenAmount((tokensConfigObj["WSTETH"]["daily_withdrawal_cap"]).toString(), "WSTETH").div(3)))).to.lt(2); // few wei error for STETH (due to division) and AToken (due to interest)
        expect(user3UsdtEndBalance).to.eq(user3UsdtStartBalance.add(parseTokenAmount((tokensConfigObj["USDT"]["daily_withdrawal_cap"]).toString(), "USDT").div(3)));
        expect(user3WbtcEndBalance).to.eq(user3WbtcStartBalance.add(parseTokenAmount((tokensConfigObj["WBTC"]["daily_withdrawal_cap"]).toString(), "WBTC").div(3)));
      })


    for (let tokenName of configObjWithETH["EthgasPoolSupportedTokens"]) {
      it(`fail to transfer ${tokenName} with amount slightly more than daily withdrawal cap`, async () => {
        const userAddress = RANDOM_ADDRESS_1;
        const userStartBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        let sendAmount: BigNumber = parseTokenAmount(((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"]) + 1).toString(), tokenName.toUpperCase());
        await expect(poolAsTreasurer.serverTransferFund(
          [userAddress], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
        ) ).to.be.revertedWith("ExceedDailyTransferCap")
        const userEndBalance: BigNumber = await tokenBalance(tokenName, userAddress);
        expect(userEndBalance).to.eq(userStartBalance);
      })

      it(`fail to transfer ${tokenName} with amount slightly more than daily withdrawal cap per person`, async () => {
        const userAddress1 = RANDOM_ADDRESS_1;
        const userAddress2 = RANDOM_ADDRESS_2;
        const userAddress3 = RANDOM_ADDRESS_3;
        const userStartBalance1: BigNumber = await tokenBalance(tokenName, userAddress1);
        const userStartBalance2: BigNumber = await tokenBalance(tokenName, userAddress2);
        const userStartBalance3: BigNumber = await tokenBalance(tokenName, userAddress3);
        
        let sendAmount: BigNumber = parseTokenAmount(((tokensConfigObjWithETH[tokenName]["daily_withdrawal_cap"] / 3 + 1).toFixed(0)).toString(), tokenName.toUpperCase());
        await expect(poolAsTreasurer.serverTransferFund(
          [userAddress1,userAddress2,userAddress3], [[ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ], [ {token: addressObjWithETH[tokenName]["token_address"], amount: sendAmount} ]]
        ) ).to.be.revertedWith("ExceedDailyTransferCap")
        const userEndBalance1: BigNumber = await tokenBalance(tokenName, userAddress1);
        const userEndBalance2: BigNumber = await tokenBalance(tokenName, userAddress2);
        const userEndBalance3: BigNumber = await tokenBalance(tokenName, userAddress3);
        expect(userEndBalance1).to.eq(userStartBalance1);
        expect(userEndBalance2).to.eq(userStartBalance2);
        expect(userEndBalance3).to.eq(userStartBalance3);
      })
    }



    it(`Timelock: Random user cannot propose serverTransferAnyFund operation`, async () => {
      const userAddress = RANDOM_ADDRESS_1;
      const erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WETH_ADDRESS);
      const userStartBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      let sendAmount: BigNumber = parseTokenAmount((tokensConfigObj["WETH"]["daily_withdrawal_cap"] + 1).toString(), "WETH");
      let encodedData: string = poolInterface.encodeFunctionData("serverTransferAnyFund", [ [userAddress], [[ {token: WETH_ADDRESS, amount: sendAmount} ]] ]);
      await expect(timelockCtrl.connect(userSigners[0]).schedule(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)).to.be.revertedWith("AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + PROPOSER_ROLE);
      let userEndBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      expect(userEndBalance).to.eq(userStartBalance.add(0));
    })

    it(`Timelock: fail to serverTransferAnyFund when delay time is not enough`, async () => {
      const userAddress = RANDOM_ADDRESS_1;
      const erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WETH_ADDRESS);
      const userStartBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      let sendAmount: BigNumber = parseTokenAmount((tokensConfigObj["WETH"]["daily_withdrawal_cap"] + 1).toString(), "WETH");
      let encodedData: string = poolInterface.encodeFunctionData("serverTransferAnyFund", [ [userAddress], [[ {token: WETH_ADDRESS, amount: sendAmount} ]] ]);
      await (await timelockCtrl.connect(proposerSigner).schedule(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)).wait();
      await network.provider.request({method:"evm_increaseTime",params:[ MIN_DELAY_SECS - 10 ]});
      await network.provider.request({method:"evm_mine",params:[ ]});
      await expect(timelockCtrl.connect(contractAdminSigner).execute(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero)).to.be.revertedWith("TimelockController: operation is not ready");
      let userEndBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      expect(userEndBalance).to.eq(userStartBalance.add(0));
    })

    it(`Timelock: proposer cannot execute serverTransferAnyFund operation`, async () => {
      const userAddress = RANDOM_ADDRESS_1;
      const erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WETH_ADDRESS);
      const userStartBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      let sendAmount: BigNumber = parseTokenAmount((tokensConfigObj["WETH"]["daily_withdrawal_cap"] + 1).toString(), "WETH");
      let encodedData: string = poolInterface.encodeFunctionData("serverTransferAnyFund", [ [userAddress], [[ {token: WETH_ADDRESS, amount: sendAmount} ]] ]);
      await (await timelockCtrl.connect(proposerSigner).schedule(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)).wait();
      await network.provider.request({method:"evm_increaseTime",params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine",params:[ ]});
      await expect(timelockCtrl.connect(proposerSigner).execute(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero)).to.be.revertedWith("AccessControl: account " +  proposerSigner.address.toLowerCase() + " is missing role " + EXECUTOR_ROLE);
      let userEndBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      expect(userEndBalance).to.eq(userStartBalance.add(0));
    })

    it(`Timelock: Performs serverTransferAnyFund operation`, async () => {
      const userAddress = RANDOM_ADDRESS_1;
      const erc20Contract = await ethers.getContractAt('contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20', WETH_ADDRESS);
      const userStartBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      let sendAmount: BigNumber = parseTokenAmount((tokensConfigObj["WETH"]["daily_withdrawal_cap"] + 1).toString(), "WETH");
      let encodedData: string = poolInterface.encodeFunctionData("serverTransferAnyFund", [ [userAddress], [[ {token: WETH_ADDRESS, amount: sendAmount} ]] ]);
      await (await timelockCtrl.connect(proposerSigner).schedule(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)).wait();
      await network.provider.request({method:"evm_increaseTime",params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine",params:[ ]});
      await (await timelockCtrl.connect(contractAdminSigner).execute(pool.address, 0, encodedData, ethers.constants.HashZero, ethers.constants.HashZero)).wait();
      let userEndBalance: BigNumber = await erc20Contract.balanceOf(userAddress);
      expect(userEndBalance).to.eq(userStartBalance.add(sendAmount));
    })    

  
  

  });

  describe("wrap ETH and unwrap WETH", ()=>{

    beforeEach("before", async() => {
      await setStartingState(pool, userSigners, wethToken, tokenA, tokenB, tokenC);      
    });

    it("can wrap ETH", async () => {
      await network.provider.request({method:"hardhat_setBalance",params:[pool.address,ethers.utils.hexStripZeros(parseTokenAmount("1", "ETH").toHexString())]});
      let poolInitEthBalance = await tokenBalance("ETH", pool.address);
      let poolInitWethBalance = await tokenBalance("WETH", pool.address);
      let wrapAmount = parseTokenAmount("1", "ETH");
      await poolAsTreasurer.wrapEth(wrapAmount);
      let poolEndEthBalance = await tokenBalance("ETH", pool.address);
      let poolEndWethBalance = await tokenBalance("WETH", pool.address);
      expect(poolInitEthBalance.sub(poolEndEthBalance)).to.eq(wrapAmount);
      expect(poolEndWethBalance.sub(poolInitWethBalance)).to.eq(wrapAmount);
    })

    it("can unwrap WETH", async () => {
      const unwrapAmount = parseTokenAmount("0.51", "ETH");
      await wethToken.connect(userSigners[0]).deposit({value: unwrapAmount})
      await wethToken.connect(userSigners[0]).approve(pool.address, unwrapAmount)
      await (
        await pool.connect(userSigners[0]).deposit(
          [{token: WETH_ADDRESS, amount: unwrapAmount}]
        )
      ).wait();
      let poolInitEthBalance = await tokenBalance("ETH", pool.address);
      let poolInitWethBalance = await tokenBalance("WETH", pool.address);
      await poolAsTreasurer.unwrapWeth(unwrapAmount);
      let poolEndEthBalance = await tokenBalance("ETH", pool.address);
      let poolEndWethBalance = await tokenBalance("WETH", pool.address);
      expect(poolEndEthBalance.sub(poolInitEthBalance)).to.eq(unwrapAmount);
      expect(poolInitWethBalance.sub(poolEndWethBalance)).to.eq(unwrapAmount);
      expect(poolEndWethBalance).eq(0);
    });

  });


  describe("Pausing contracts", ()=>{
    beforeEach("before", async() => {
        await setStartingState(pool, userSigners, wethToken, tokenA, tokenB, tokenC);
        await (await pool.connect(pauserSigner).pause()).wait();
        
    });

    it("pauser cannot unpause contract", async () => {
      await expect(pool.connect(pauserSigner).unpause()).to.be.revertedWith("AccessControl: account " +  pauserSigner.address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE);
    })

    it("Deposit is paused", async () => {
      await expect(pool.connect(userSigners[0]).deposit([],{value: TOKEN_START_AMOUNT.sub(BigNumber.from('53743416618353744'))})).to.be.revertedWith('EnforcedPause()')
      
    });




    it("serverTransferFund, serverTransferAnyFund & serverPayout are paused", async () => {
      await expect(poolAsTreasurer.serverTransferFundSingle(
        userSigners[0].address, [ {token: wethToken.address, amount: 10} ]
      )).to.be.revertedWith('EnforcedPause');

      await expect(poolAsTreasurer.serverTransferFund(
        [userSigners[0].address], [[ {token: wethToken.address, amount: 10} ]]
      )).to.be.revertedWith('EnforcedPause()');

      await expect(pool.connect(await ethers.getSigner(timelockCtrl.address)).serverTransferAnyFund(
        [userSigners[0].address], [[ {token: wethToken.address, amount: 10} ]]
      )).to.be.revertedWith('EnforcedPause()');

      await expect(poolAsTreasurer.serverTransferFund(
        [userSigners[0].address], [[ {token: NATIVE_ETH_ADDRESS, amount: 10} ]]
      )).to.be.revertedWith('EnforcedPause()');

      await expect(pool.connect(await ethers.getSigner(timelockCtrl.address)).serverTransferAnyFund(
        [userSigners[0].address], [[ {token: NATIVE_ETH_ADDRESS, amount: 10} ]]
      )).to.be.revertedWith('EnforcedPause()');

      let blockNumber = await ethers.provider.getBlockNumber();
      await expect(
        poolAsPayouter.serverPayout(
          RANDOM_ADDRESS_1, [ {token: addressObjWithETH["ETH"]["token_address"], amount: parseTokenAmount("0.1", "ETH")} ], blockNumber + 1
        )
      ).to.be.revertedWith('EnforcedPause');
    });
      



  });

});
