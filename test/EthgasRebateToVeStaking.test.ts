// import { Contract, Signer } from "ethers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";


import { ethers, network, waffle, getNamedAccounts, deployments } from "hardhat";
const { loadFixture } = waffle;
import { BigNumber, ContractReceipt, constants, Contract, ContractTransaction, errors } from 'ethers';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EthgasRebate, ACLManager, IWETH, IERC20, TestERC20, TimelockController} from '../typechain';
const {  DEFAULT_ADMIN_ROLE, TREASURER_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE } = require(`../helpers/constants`)
import { Interface } from "ethers/lib/utils";

const { parseTokenAmount, formatTokenAmount } = require(`../helpers/utils`)
import chaiAsPromised from 'chai-as-promised';
import chai from "chai";
const { expect } = chai
chai.use(chaiAsPromised);

const MINT_AMOUNT = parseTokenAmount("100000000", "WETH");
const TOKEN_START_AMOUNT = parseTokenAmount("1", "WETH");
const GAS_REBATE_CATEGORY = ethers.utils.formatBytes32String("GAS_REBATE");
const AIRDROP_CATEGORY = ethers.utils.formatBytes32String("AIRDROP");
const oneYearInSec = 3600 * 24 * 365

import hre from "hardhat";

const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const tokensConfigObj = configObj['Tokens'];
const MIN_DELAY_SECS = configObj["TimelockControllerMinDelayInSecond"]
const addressObj = require(`../helpers/address/local.json`);
let supportedTokensArr: string[] = []
let dailyWithdrawalCapArr = []
for (let tokenName of configObj["EthgasRebateSupportedTokens"]) {
  dailyWithdrawalCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_withdrawal_cap.toString(), tokenName))
  supportedTokensArr.push(addressObj[tokenName]["token_address"])
}
const WETH_ADDRESS = addressObj["WETH"]["token_address"];
const USDT_ADDRESS = addressObj["USDT"]["token_address"];
const GWEI_ADDRESS = addressObj["GWEI"]["token_address"];
const VEGWEI_ADDRESS = addressObj["VEGWEI"]["token_address"];

async function getLatestBlockTimestamp() {
  const latestBlock = await ethers.provider.getBlock("latest");
  const timestamp = latestBlock.timestamp;
  return timestamp
}

describe("EthgasRebate to Voting Escrow", function () {
  let ethgasRebate: EthgasRebate;
  let ethgasRebateInterface: Interface;
  let ethgasRebateAsBookKeeper: EthgasRebate;
  let ethgasRebateAsDeployer: EthgasRebate;
  let mockToken: Contract;
  let aclManager: ACLManager;
  let wethToken: IWETH;
  let usdtToken: IERC20;
  let ethgasToken: IERC20;
  let veToken: Contract;

  let deployerSigner: SignerWithAddress;
  let contractAdminSigner: SignerWithAddress;
  let pauserSigner: SignerWithAddress;
  let proposerSigner: SignerWithAddress;
  let bookKeeperSigner: SignerWithAddress;
  let userSigners: SignerWithAddress[];
  let merkleTree: MerkleTree;
  let timelockCtrl: TimelockController;

  beforeEach(async function () {
    // Get signers
    const { deployer, contractAdmin, treasurer, pauser, proposer, bookKeeper, user0, user1, user2, user3 } = await getNamedAccounts();

    
    deployerSigner = await ethers.getSigner(deployer);
    contractAdminSigner = await ethers.getSigner(contractAdmin);
    pauserSigner = await ethers.getSigner(pauser);
    proposerSigner = await ethers.getSigner(proposer);
    bookKeeperSigner = await ethers.getSigner(bookKeeper);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];
    const configObj: Record<string, any> = require(`../helpers/config/` + hre.network.name + `.json`);
    const tokensConfigObj: Record<string, Record<string, any>> = configObj["Tokens"];
    const { DEFAULT_ADMIN_ROLE } = require(`../helpers/constants`)

    await deployments.fixture(['EthgasSetup','EthgasRebate']);
    let aclManagerDeploy = await deployments.get('ACLManager');
    aclManager = await ethers.getContractAt('ACLManager', aclManagerDeploy.address,  contractAdminSigner ) as ACLManager;
    let ethgasRebateDeploy = await deployments.get('EthgasRebate');
    ethgasRebateInterface = new ethers.utils.Interface(ethgasRebateDeploy.abi);
    ethgasRebate = await ethers.getContractAt('EthgasRebate', ethgasRebateDeploy.address, contractAdminSigner) as EthgasRebate;
    ethgasRebateAsBookKeeper = ethgasRebate.connect(bookKeeperSigner);
    ethgasRebateAsDeployer = ethgasRebate.connect(deployerSigner);
    const timelockCtrlDeploy = await deployments.get('TimelockController');
    timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, contractAdminSigner) as TimelockController;
    wethToken = await ethers.getContractAt("IWETH", WETH_ADDRESS) as IWETH;
    usdtToken = await ethers.getContractAt("contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20", USDT_ADDRESS) as IERC20;
    ethgasToken = await ethers.getContractAt("contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20", GWEI_ADDRESS) as IERC20;
    veToken = await ethers.getContractAt("IVotingEscrow", VEGWEI_ADDRESS)

    let leaves = [
      // first leaf is a salt to avoid merkle root collision because of same claim data
      ethers.utils.solidityKeccak256(
        ["uint256"],
        [Math.floor(Math.random() * 100000)]
      ),
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [userSigners[0].address, GWEI_ADDRESS, parseTokenAmount("150", "GWEI")]
      ),
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [
          userSigners[1].address, GWEI_ADDRESS, parseTokenAmount("16", "GWEI")
        ]
      ),
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256"],
        [
          userSigners[1].address, WETH_ADDRESS, parseTokenAmount("1.5", "ETH"), 
          userSigners[2].address, WETH_ADDRESS, parseTokenAmount("2", "ETH"),
          userSigners[1].address, USDT_ADDRESS, parseTokenAmount("10.5", "USDT"), 
          userSigners[2].address, USDT_ADDRESS, parseTokenAmount("22", "USDT"), 
          userSigners[3].address, USDT_ADDRESS, parseTokenAmount("33", "USDT")
        ]
      )
    ]

    merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });

    //whitelist depositor
    await (await ethgasRebate.connect(contractAdminSigner).setDepositorWhitelist([deployerSigner.address], [true])).wait();
  });


  describe("Claiming Rewards", function () {
    beforeEach(async function () {
      await ethgasRebateAsBookKeeper.startRestrictedMode();

      // Set merkle root
      await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY);
      await ethgasRebateAsBookKeeper.updateMerkleRootInfo(true, oneYearInSec, GAS_REBATE_CATEGORY);
      
      let sendAmount = parseTokenAmount("178", "ETH");
      await ( await ethgasToken.connect(deployerSigner).approve(ethgasRebate.address, sendAmount) ).wait();
      await (await ethgasRebateAsDeployer["deposit(address[],uint256[])"]([GWEI_ADDRESS], [sendAmount])).wait();
      const whitelistedAddresses = Array(30).fill(ethers.constants.AddressZero);
      whitelistedAddresses[0] = ethgasRebate.address;
      const isWhitelists = Array(30).fill(true)
      await veToken.connect(contractAdminSigner).whitelist_contracts(whitelistedAddresses, isWhitelists);
    });

    it("Should allow user to claim reward and stake", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("150", "GWEI");
      
      expect(await ethgasToken.balanceOf(user0Address)).to.equal(0); //starting zero balance
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, GWEI_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);
      let currentTimestamp = await getLatestBlockTimestamp()
      expect(await veToken.balanceOf(user0Address)).to.equal(0);

      // first tx fail to stake less than the min unlock duration
      let tx = ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: GWEI_ADDRESS, claimAmount: amount}
        ],
        [GWEI_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        true,
        currentTimestamp + oneYearInSec - 10
      )
      await expect(tx).revertedWith("InvalidUnlockTime")

      // 2nd tx succeed
      console.log("\nuser0 claim and stake 2 years")
      tx = ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: GWEI_ADDRESS, claimAmount: amount}
        ],
        [GWEI_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        true,
        currentTimestamp + oneYearInSec * 2
      )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed")
        .withArgs(
          user0Address, ethgasToken.address, amount
        )
      console.log("Gwei claimed:", formatTokenAmount(amount, "GWEI"))
      await expect(tx).emit(ethgasRebate, "RewardStaked")
        .withArgs(user0Address, amount, currentTimestamp + oneYearInSec * 2);
      expect(await ethgasToken.balanceOf(user0Address)).to.equal(0);
      console.log("veGwei balance:", formatTokenAmount(await veToken.balanceOf(user0Address), "GWEI"))


      // update new merkle tree category without staking required
      await ethgasRebateAsBookKeeper.startRestrictedMode();
      await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), AIRDROP_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();

      expect(await ethgasRebate.merkleRoot(AIRDROP_CATEGORY)).to.equal(merkleTree.getHexRoot());
      const airdropMerkleTreeInfo = await ethgasRebate.merkleRootInfo(AIRDROP_CATEGORY);
      expect(airdropMerkleTreeInfo[0]).to.equal(false);
      expect(airdropMerkleTreeInfo[1]).to.equal(0);
      expect(await ethgasRebate.merkleRoot(GAS_REBATE_CATEGORY)).to.equal(merkleTree.getHexRoot());
      const gasbateMerkleTreeInfo = await ethgasRebate.merkleRootInfo(GAS_REBATE_CATEGORY);
      expect(gasbateMerkleTreeInfo[0]).to.equal(true);
      expect(gasbateMerkleTreeInfo[1]).to.equal(oneYearInSec);

      const amount2 = parseTokenAmount("16", "ETH");
      const user1Address = await userSigners[1].getAddress();
      const leaf2 = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user1Address, GWEI_ADDRESS, amount2]
      );
      const proof2 = merkleTree.getHexProof(leaf2);
      currentTimestamp = await getLatestBlockTimestamp()

      // 3rd claim and stake tx succeed
      console.log("\nuser1 claim and stake 1 year")
      tx = ethgasRebate.connect(userSigners[1]).claimReward(
        [
          {user: user1Address, token: GWEI_ADDRESS, claimAmount: amount2}
        ],
        [GWEI_ADDRESS],
        proof2,
        AIRDROP_CATEGORY,
        true,
        currentTimestamp + oneYearInSec
      )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed")
        .withArgs(
          user1Address, ethgasToken.address, amount2
        )
      console.log("Gwei claimed:", formatTokenAmount(amount2, "GWEI"))
      await expect(tx).emit(ethgasRebate, "RewardStaked")
        .withArgs(user1Address, amount2, currentTimestamp + oneYearInSec);
      expect(await ethgasToken.balanceOf(user1Address)).to.equal(0);
      console.log("veGwei balance:", formatTokenAmount(await veToken.balanceOf(user1Address), "GWEI"))


      const amount3 = parseTokenAmount("12", "ETH");
      const leaves = [
        ethers.utils.solidityKeccak256(
          ["uint256"],
          [Math.floor(Math.random() * 100000)]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [userSigners[0].address, GWEI_ADDRESS, amount3]
        )
      ]
      const newTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      await ethgasRebateAsBookKeeper.startRestrictedMode();
      await ethgasRebateAsBookKeeper.updateMerkleRoot(newTree.getHexRoot(), GAS_REBATE_CATEGORY);
      await ethgasRebateAsBookKeeper.updateMerkleRootInfo(true, oneYearInSec * 3, GAS_REBATE_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      // 4th tx succeed, not subject to new unlock duration as the user already staked
      console.log("\nuser0 claim and stake again")
      const proof3 = newTree.getHexProof(leaves[1]);
      currentTimestamp = await getLatestBlockTimestamp()
      tx = ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: GWEI_ADDRESS, claimAmount: amount3}
        ],
        [GWEI_ADDRESS],
        proof3,
        GAS_REBATE_CATEGORY,
        true,
        0
      )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed")
        .withArgs(
          user0Address, ethgasToken.address, amount3
        )
      console.log("Gwei claimed:", formatTokenAmount(amount3, "GWEI"))
      await expect(tx).emit(ethgasRebate, "RewardStaked")
        .withArgs(user0Address, amount3, 0);
      expect(await ethgasToken.balanceOf(user0Address)).to.equal(0);
      console.log("veGwei balance:", formatTokenAmount(await veToken.balanceOf(user0Address), "GWEI"))
    });

  });

});