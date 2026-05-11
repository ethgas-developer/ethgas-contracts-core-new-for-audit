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

const { parseTokenAmount} = require(`../helpers/utils`)
import chaiAsPromised from 'chai-as-promised';
import chai from "chai";
const { expect } = chai
chai.use(chaiAsPromised);

const MINT_AMOUNT = parseTokenAmount("100000000", "WETH");
const TOKEN_START_AMOUNT = parseTokenAmount("1", "WETH");
const GAS_REBATE_CATEGORY = ethers.utils.formatBytes32String("GAS_REBATE");
const AIRDROP_CATEGORY = ethers.utils.formatBytes32String("AIRDROP");

import hre from "hardhat";

const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const tokensConfigObj = configObj['Tokens'];
const MIN_DELAY_SECS = configObj["TimelockControllerMinDelayInSecond"]
const addressObj = require(`../helpers/address/mainnet.json`);
let supportedTokensArr: string[] = []
let dailyWithdrawalCapArr = []
for (let tokenName of configObj["EthgasRebateSupportedTokens"]) {
  dailyWithdrawalCapArr.push( parseTokenAmount(tokensConfigObj[tokenName].daily_withdrawal_cap.toString(), tokenName))
  supportedTokensArr.push(addressObj[tokenName]["token_address"])
}
const WETH_ADDRESS = addressObj["WETH"]["token_address"];
const USDT_ADDRESS = addressObj["USDT"]["token_address"];

// async function setNextBlockTimestamp(targetTimestamp: number) {
//       await network.provider.request({
//         method: "evm_setNextBlockTimestamp",
//         params: [targetTimestamp]
//       });
//       await network.provider.request({method: "evm_mine"});
// }

describe("EthgasRebate", function () {
  let ethgasRebate: EthgasRebate;
  let ethgasRebateInterface: Interface;
  let ethgasRebateAsBookKeeper: EthgasRebate;
  let mockToken: Contract;
  let aclManager: ACLManager;
  let wethToken: IWETH;
  let usdtToken: IERC20;

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
    const { deployerFoundation, contractAdminFoundation, pauserFoundation, proposerFoundation, bookKeeperFoundation, user0, user1, user2, user3 } = await getNamedAccounts();

    
    deployerSigner = await ethers.getSigner(deployerFoundation);
    contractAdminSigner = await ethers.getSigner(contractAdminFoundation);
    pauserSigner = await ethers.getSigner(pauserFoundation);
    proposerSigner = await ethers.getSigner(proposerFoundation);
    bookKeeperSigner = await ethers.getSigner(bookKeeperFoundation);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];
    let addressObj: Record<string, any> = require(`../helpers/address/mainnet.json`);
    const configObj: Record<string, any> = require(`../helpers/config/` + hre.network.name + `.json`);
    const tokensConfigObj: Record<string, Record<string, any>> = configObj["Tokens"];
    const { DEFAULT_ADMIN_ROLE } = require(`../helpers/constants`)

    await deployments.fixture(['EthgasSetupFoundation','EthgasRebate']);
    
    // Deploy ACLManager
    let aclManagerDeploy = await deployments.get('ACLManagerFoundation');
    aclManager = await ethers.getContractAt('ACLManager', aclManagerDeploy.address,  contractAdminSigner ) as ACLManager;

    // Deploy EthgasRebate
    let ethgasRebateDeploy = await deployments.get('EthgasRebate');
    ethgasRebateInterface = new ethers.utils.Interface(ethgasRebateDeploy.abi);
    ethgasRebate = await ethers.getContractAt('EthgasRebate', ethgasRebateDeploy.address, contractAdminSigner) as EthgasRebate;
    ethgasRebateAsBookKeeper = ethgasRebate.connect(bookKeeperSigner);

    const timelockCtrlDeploy = await deployments.get('TimelockControllerFoundation');
    timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address, contractAdminSigner) as TimelockController;


    wethToken = await ethers.getContractAt("IWETH", WETH_ADDRESS) as IWETH;
    usdtToken = await ethers.getContractAt("contracts/dependencies/openzeppelin-v5.0.1/token/IERC20.sol:IERC20", USDT_ADDRESS) as IERC20;

    let leaves = [
      // first leaf is a salt to avoid merkle root collision because of same claim data
      ethers.utils.solidityKeccak256(
        ["uint256"],
        [Math.floor(Math.random() * 100000)]
      ),
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [userSigners[0].address, WETH_ADDRESS, parseTokenAmount("1", "ETH")]
      ),
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256"],
        [
          userSigners[1].address, WETH_ADDRESS, parseTokenAmount("1.5", "ETH"), 
          userSigners[2].address, WETH_ADDRESS, parseTokenAmount("2", "ETH"),
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
    await (await ethgasRebate.connect(contractAdminSigner).setDepositorWhitelist([bookKeeperSigner.address], [true])).wait();
  });

  describe("Constructor", function () {
    it("Should set the ACLManager correctly", async function () {
      expect(await ethgasRebate.aclManager()).to.equal(aclManager.address);
    });
  });

  describe("updateMerkleRoot", function () {
    it("Should allow book keeper to update merkle root", async function () {
      const newRoot = merkleTree.getHexRoot();
      
      await ethgasRebateAsBookKeeper.startRestrictedMode();

      await expect(ethgasRebateAsBookKeeper.updateMerkleRoot(newRoot, GAS_REBATE_CATEGORY))
        .to.emit(ethgasRebate, "MerkleRootUpdated")
        .withArgs(newRoot, GAS_REBATE_CATEGORY);

      expect(await ethgasRebate.merkleRoot(GAS_REBATE_CATEGORY)).to.equal(newRoot);
      const merkleRootInfo = await ethgasRebate.merkleRootInfo(GAS_REBATE_CATEGORY);
      expect(merkleRootInfo[0]).to.equal(false);
      expect(merkleRootInfo[1]).to.equal(0);
    });

    it("Should revert if caller is not bookKeeper", async function () {
      const newRoot = merkleTree.getHexRoot();
      
      await expect(
        ethgasRebate.connect(userSigners[0]).updateMerkleRoot(newRoot, GAS_REBATE_CATEGORY)
      ).to.be.revertedWith("AccessControl: account");
    });
  });



  

  describe("Claiming Rewards", function () {
    beforeEach(async function () {
      await ethgasRebateAsBookKeeper.startRestrictedMode();

      // Set merkle root
      await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY);
      
      // Fund the contract with tokens
      await (await ethgasRebateAsBookKeeper["deposit()"]({value: parseTokenAmount("70", "ETH")})).wait();

      let walletAddress = addressObj["USDT"]["impersonate_holder_address"];
      let sendAmount = parseTokenAmount(tokensConfigObj["USDT"]["test_fund_transfer_amount"].toString(), "USDT");
      await network.provider.request({method: "hardhat_impersonateAccount", params: [ walletAddress ]});
      let walletSigner = await ethers.getSigner(walletAddress);
      await ( await usdtToken.connect(walletSigner).transfer(bookKeeperSigner.address, sendAmount) ).wait();
      await ( await usdtToken.connect(bookKeeperSigner).approve(ethgasRebate.address, sendAmount) ).wait();
      await (await ethgasRebateAsBookKeeper["deposit(address[],uint256[])"]([USDT_ADDRESS], [sendAmount])).wait();
    });

    it("Should allow user to claim reward with valid proof", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      expect(await wethToken.balanceOf(user0Address)).to.equal(0); //starting zero balance
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.emit(ethgasRebate, "RewardClaimed")
       .withArgs(user0Address, wethToken.address, amount);

      expect(await wethToken.balanceOf(user0Address)).to.equal(amount);
    });

    it("Should allow user to claim reward for primary and sub wallet at once with valid proof", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user1Address = await userSigners[1].getAddress();
      const user2Address = await userSigners[2].getAddress();
      const amount = parseTokenAmount("1.5", "ETH");
      const amount2 = parseTokenAmount("2", "ETH");
      
      expect(await wethToken.balanceOf(user1Address)).to.equal(0); //starting zero balance
      expect(await wethToken.balanceOf(user2Address)).to.equal(0); //starting zero balance
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256"],
        [user1Address, WETH_ADDRESS, amount, user2Address, WETH_ADDRESS, amount2]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        ethgasRebate.connect(userSigners[1]).claimReward(
          [
            {user: user1Address, token: WETH_ADDRESS, claimAmount: amount},
            {user: user2Address, token: WETH_ADDRESS, claimAmount: amount2}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.emit(ethgasRebate, "RewardClaimed")
       .withArgs(user1Address, wethToken.address, amount.add(amount2));

      expect(await wethToken.balanceOf(user1Address)).to.equal(amount.add(amount2));
    });

    it("claim should revert if the users doesn't claim using primary wallet", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user1Address = await userSigners[1].getAddress();
      const user2Address = await userSigners[2].getAddress();
      const amount = parseTokenAmount("1.5", "ETH");
      const amount2 = parseTokenAmount("2", "ETH");
      
      expect(await wethToken.balanceOf(user1Address)).to.equal(0); //starting zero balance
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256"],
        [user1Address, WETH_ADDRESS, amount, user2Address, WETH_ADDRESS, amount2]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        ethgasRebate.connect(userSigners[2]).claimReward(
          [
            {user: user1Address, token: WETH_ADDRESS, claimAmount: amount},
            {user: user2Address, token: WETH_ADDRESS, claimAmount: amount2}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("UnauthorizedClaim");

      expect(await wethToken.balanceOf(user1Address)).to.equal(0);
    });

    it("reward claim should revert with invalid proof", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);
      
      // Modify amount to make proof invalid
      const invalidAmount = parseTokenAmount("3", "ETH");
      
      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: user0Address, token: WETH_ADDRESS, claimAmount: invalidAmount}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("InvalidProof");
    });

    it("reward claim should revert with wrong order of proof", async function () {
      // add leaf to create a more complex tree
      const user2Address = await userSigners[2].getAddress();
      let leaf: any = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user2Address, WETH_ADDRESS, parseTokenAmount("51", "ETH")]
      );
      merkleTree.addLeaf(leaf);
      await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);
      
      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
          ],
          [WETH_ADDRESS],
          proof.reverse(),
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("InvalidProof");
    });

    it("no error to claim for 0 amount", async function () {
      const user2Address = await userSigners[2].getAddress();
      expect(await wethToken.balanceOf(user2Address)).to.eq(0);
      const amount = 0;
      const leaf: any = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user2Address, WETH_ADDRESS, amount]
      );
      merkleTree.addLeaf(leaf);
      await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      
      const proof = merkleTree.getHexProof(leaf);
      
      const receipt = await (await ethgasRebate.connect(userSigners[2]).claimReward(
        [
          {user: user2Address, token: WETH_ADDRESS, claimAmount: amount}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      )).wait()
      expect(receipt.events!.length).to.eq(0);
      expect(await wethToken.balanceOf(user2Address)).to.eq(0);
    });

    it("Should prevent double claiming", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);
      
      const initBalance = await wethToken.balanceOf(userSigners[0].address); 
      // First claim should succeed
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      );
      const firstClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(firstClaimBalance.sub(initBalance)).to.eq(amount);

      // Second claim should fail
      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("RewardAlreadyClaimed");
      const secondClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(secondClaimBalance.sub(firstClaimBalance)).to.eq(0);
    });

    it("Should allow user to claim for the same root with different salts of same category", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      let proof = merkleTree.getHexProof(leaf);
      
      const initBalance = await wethToken.balanceOf(userSigners[0].address); 
      // First claim should succeed
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      );
      const firstClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(firstClaimBalance.sub(initBalance)).to.eq(amount);

      // update the salt leaf
      let leaf0 :any = ethers.utils.solidityKeccak256(
        ["uint256"],
        [Math.floor(Math.random() * 100000)]
      );
      merkleTree.updateLeaf(0, leaf0);
      proof = merkleTree.getHexProof(leaf);
      await ethgasRebateAsBookKeeper.startRestrictedMode();
      await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();

      // Second claim should succeed
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: amount}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      )
      const secondClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(secondClaimBalance.sub(firstClaimBalance)).to.eq(amount);
    });

    it("Should allow user to claim for two roots of different categories", async function () {
      const airdropAmount = parseTokenAmount("1.3", "ETH");
      const airdropleaves = [
        ethers.utils.solidityKeccak256(
          ["uint256"],
          [Math.floor(Math.random() * 100000)]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [userSigners[0].address, WETH_ADDRESS, airdropAmount]
        )
      ]
      const airdropMerkleTree = new MerkleTree(airdropleaves, keccak256, { sortPairs: true });
      await ethgasRebateAsBookKeeper.updateMerkleRoot(airdropMerkleTree.getHexRoot(), AIRDROP_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();

      expect(await ethgasRebate.merkleRoot(AIRDROP_CATEGORY)).to.equal(airdropMerkleTree.getHexRoot());
      const airdropMerkleTreeInfo = await ethgasRebate.merkleRootInfo(AIRDROP_CATEGORY);
      expect(airdropMerkleTreeInfo[0]).to.equal(false);
      expect(airdropMerkleTreeInfo[1]).to.equal(0);
      expect(await ethgasRebate.merkleRoot(GAS_REBATE_CATEGORY)).to.equal(merkleTree.getHexRoot());
      const gasbateMerkleTreeInfo = await ethgasRebate.merkleRootInfo(GAS_REBATE_CATEGORY);
      expect(gasbateMerkleTreeInfo[0]).to.equal(false);
      expect(gasbateMerkleTreeInfo[1]).to.equal(0);

      const user0Address = await userSigners[0].getAddress();
      const gasRebateAmount = parseTokenAmount("1", "ETH");
      const gasRebateleaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, gasRebateAmount]
      );
      const gasRebateProof = merkleTree.getHexProof(gasRebateleaf);
      
      const initBalance = await wethToken.balanceOf(userSigners[0].address); 
      // First claim should succeed
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: gasRebateAmount}
        ],
        [WETH_ADDRESS],
        gasRebateProof,
        GAS_REBATE_CATEGORY,
        false,
        0
      );
      const firstClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(firstClaimBalance.sub(initBalance)).to.eq(gasRebateAmount);


      const airdropProof = airdropMerkleTree.getHexProof(airdropleaves[1]);
      // Second claim should fail when the category is wrong
      await expect(ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: airdropAmount}
        ],
        [WETH_ADDRESS],
        airdropProof,
        ethers.utils.formatBytes32String("RANDOM"),
        false,
        0
      )).to.be.revertedWith("InvalidProof")
      // Third claim should succeed when the category is correct
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: airdropAmount}
        ],
        [WETH_ADDRESS],
        airdropProof,
        AIRDROP_CATEGORY,
        false,
        0
      )
      const secondClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(secondClaimBalance.sub(firstClaimBalance)).to.eq(airdropAmount);
    });

    it("Should allow user to claim for same roots with same salts of different categories", async function () {
      const airdropAmount = parseTokenAmount("2.2", "ETH");
      const airdropleaves = [
        ethers.utils.solidityKeccak256(
          ["uint256"],
          [Math.floor(Math.random() * 100000)]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [userSigners[0].address, WETH_ADDRESS, airdropAmount]
        )
      ]
      const airdropMerkleTree = new MerkleTree(airdropleaves, keccak256, { sortPairs: true });
      const AIRDROP_1_CATEGORY = ethers.utils.formatBytes32String("AIRDROP1")
      const AIRDROP_2_CATEGORY = ethers.utils.formatBytes32String("AIRDROP2")
      await ethgasRebateAsBookKeeper.updateMerkleRoot(airdropMerkleTree.getHexRoot(), AIRDROP_1_CATEGORY);
      await ethgasRebateAsBookKeeper.updateMerkleRoot(airdropMerkleTree.getHexRoot(), AIRDROP_2_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();

      const user0Address = await userSigners[0].getAddress();
      const initBalance = await wethToken.balanceOf(userSigners[0].address); 
      // First claim should succeed
      const airdropProof = airdropMerkleTree.getHexProof(airdropleaves[1]);
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: airdropAmount}
        ],
        [WETH_ADDRESS],
        airdropProof,
        AIRDROP_1_CATEGORY,
        false,
        0
      )
      const firstClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(firstClaimBalance.sub(initBalance)).to.eq(airdropAmount);

      // first claim should succeed
      await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: user0Address, token: WETH_ADDRESS, claimAmount: airdropAmount}
        ],
        [WETH_ADDRESS],
        airdropProof,
        AIRDROP_2_CATEGORY,
        false,
        0
      )
      const secondClaimBalance = await wethToken.balanceOf(userSigners[0].address); 
      expect(secondClaimBalance.sub(firstClaimBalance)).to.eq(airdropAmount);
    });

    it("Add leaf to merkle tree and claim", async function () {
      expect(await wethToken.balanceOf(userSigners[0].address)).to.equal(0); 
      expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(0); 

      const user2Address = await userSigners[2].getAddress();
      
      let leaf :any = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user2Address, WETH_ADDRESS, parseTokenAmount("8", "ETH")]
      );

      merkleTree.addLeaf(leaf);
      await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      let proof = merkleTree.getHexProof(leaf);

      // user2 claim should succeed
      expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(0); 
      await (await ethgasRebate.connect(userSigners[2]).claimReward(
        [
          {user: user2Address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("8", "ETH")}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      )).wait();

      expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("8", "ETH")); 

      // user0 claim should also succeed
      expect(await wethToken.balanceOf(userSigners[0].address)).to.equal(0); 
      leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [userSigners[0].address, WETH_ADDRESS, parseTokenAmount("1", "ETH")]
      );
      proof = merkleTree.getHexProof(leaf);
      await (await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
        ],
        [WETH_ADDRESS],
        proof,
        GAS_REBATE_CATEGORY,
        false,
        0
      )).wait();

      expect(await wethToken.balanceOf(userSigners[0].address)).to.equal(parseTokenAmount("1", "ETH")); 
    });

    it("reward claim amount equals to daily withdrawal cap", async function () {
        let leaf :any = ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [await userSigners[2].getAddress(), WETH_ADDRESS, parseTokenAmount("50", "ETH")]
        );
        merkleTree.addLeaf(leaf);
        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        let proof = merkleTree.getHexProof(leaf);

        await (await ethgasRebate.connect(userSigners[2]).claimReward(
            [
              {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("50", "ETH")}
            ],
            [WETH_ADDRESS],
            proof,
            GAS_REBATE_CATEGORY,
            false,
            0
        )).wait();
        expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("50", "ETH"));
    });


    it("reward claim amount exceeds daily withdrawal cap", async function () {
        const user2Address = await userSigners[2].getAddress();
        
        let leaf :any = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user2Address, WETH_ADDRESS, parseTokenAmount("51", "ETH")]
        );
  
        merkleTree.addLeaf(leaf);
        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        let proof = merkleTree.getHexProof(leaf);
  
        // Error on claim
        await expect(
            ethgasRebate.connect(userSigners[2]).claimReward(
              [
                {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("51", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.be.revertedWith("DailyWithdrawalCapReached");
    });

    it("reward claim amount for primary & sub wallet exceeds daily withdrawal cap", async function () {
      const user2Address = await userSigners[2].getAddress();
      
      let leaf: any = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256"],
        [userSigners[2].address, WETH_ADDRESS, parseTokenAmount("25", "ETH"), userSigners[3].address, WETH_ADDRESS, parseTokenAmount("26", "ETH")]
      )

      merkleTree.addLeaf(leaf);
      await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      let proof = merkleTree.getHexProof(leaf);

      // Error on claim
      await expect(
          ethgasRebate.connect(userSigners[2]).claimReward(
            [
              {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("25", "ETH")},
              {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("26", "ETH")}
            ],
            [WETH_ADDRESS],
            proof,
            GAS_REBATE_CATEGORY,
            false,
            0
          )
        ).to.be.revertedWith("DailyWithdrawalCapReached");
  });

    it("reward claim amount exceeds daily withdrawal cap but can claim after the limit is raised.", async function () {
        const user2Address = await userSigners[2].getAddress();
        
        let leaf :any = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user2Address, WETH_ADDRESS, parseTokenAmount("51", "ETH")]
        );
  
        merkleTree.addLeaf(leaf);
        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        let proof = merkleTree.getHexProof(leaf);
  
        // Error on claim
        await expect(
            ethgasRebate.connect(userSigners[2]).claimReward(
              [
                {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("51", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.be.revertedWith("DailyWithdrawalCapReached");
        expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("0", "ETH"));

        await ((await ethgasRebate.connect(contractAdminSigner).setDailyWithdrawalCap([WETH_ADDRESS], [parseTokenAmount("51", "ETH")]))).wait()

        await (await ethgasRebate.connect(userSigners[2]).claimReward(
          [
            {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("51", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )).wait();
        expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("51", "ETH"));

    });

    it("Total claim exceeds daily withdrawal cap", async function () {
        //First claim is successful
        let leaf1 :any = ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [await userSigners[2].getAddress(), WETH_ADDRESS, parseTokenAmount("8", "ETH")]
        );
        merkleTree.addLeaf(leaf1);

        let leaf2 : any= ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [await userSigners[3].getAddress(), WETH_ADDRESS, parseTokenAmount("43", "ETH")]
        );
  
        merkleTree.addLeaf(leaf2);

        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        let proof = merkleTree.getHexProof(leaf1);

        // First claim should succeed
        await (await ethgasRebate.connect(userSigners[2]).claimReward(
            [
              {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("8", "ETH")}
            ],
            [WETH_ADDRESS],
            proof,
            GAS_REBATE_CATEGORY,
            false,
            0
        )).wait();
        expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("8", "ETH")); 

        //Second claim fails
        proof = merkleTree.getHexProof(leaf2);
        // Error on claim
        await expect(
            ethgasRebate.connect(userSigners[3]).claimReward(
              [
                {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("43", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.be.revertedWith("DailyWithdrawalCapReached");
    });

    it("Daily withdrawal cap resets after a day", async function () {
        //First claim is successful
        let leaf1 :any = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [await userSigners[2].getAddress(), WETH_ADDRESS, parseTokenAmount("8", "ETH")]
        );
        merkleTree.addLeaf(leaf1);
      
        let leaf2 : any= ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [await userSigners[3].getAddress(), WETH_ADDRESS, parseTokenAmount("43", "ETH")]
        );
        merkleTree.addLeaf(leaf2);   
        

        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        let proof = merkleTree.getHexProof(leaf1);
      
        // First claim should succeed
        await (await ethgasRebate.connect(userSigners[2]).claimReward(
          [
            {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("8", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )).wait();
        expect(await wethToken.balanceOf(userSigners[2].address)).to.equal(parseTokenAmount("8", "ETH")); 
      
        //Second claim fails
        proof = merkleTree.getHexProof(leaf2);
        // Error on claim
        await expect(
          ethgasRebate.connect(userSigners[3]).claimReward(
          [
            {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("43", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )).to.be.revertedWith("DailyWithdrawalCapReached");

        expect(await wethToken.balanceOf(userSigners[3].address)).to.equal(parseTokenAmount("0", "ETH")); 

        //Same transaction should continue to fail 10s before cap reset
        await network.provider.request({method:"evm_increaseTime", params:[ 86400 - 10 ]});
        await network.provider.request({method:"evm_mine", params:[ ]});

        proof = merkleTree.getHexProof(leaf2);
  
        // Error on claim
        await expect(
            ethgasRebate.connect(userSigners[3]).claimReward(
              [
                {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("43", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.be.revertedWith("DailyWithdrawalCapReached");

        expect(await wethToken.balanceOf(userSigners[3].address)).to.equal(parseTokenAmount("0", "ETH")); 

        //Same transaction should succeed after cap reset
        await network.provider.request({method:"evm_increaseTime", params:[ 10 ]});
        await network.provider.request({method:"evm_mine", params:[ ]});

        await (await ethgasRebate.connect(userSigners[3]).claimReward(
            [
              {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("43", "ETH")}
            ],
            [WETH_ADDRESS],
            proof,
            GAS_REBATE_CATEGORY,
            false,
            0
        )).wait();
        expect(await wethToken.balanceOf(userSigners[3].address)).to.equal(parseTokenAmount("43", "ETH")); 

    });

    it("Unable to claim if contract runs out of funds.", async function () {
      
        //add claim that will drain 
        const user2Address = await userSigners[2].getAddress();
        
        let leaf1 :any = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user2Address, WETH_ADDRESS.toLowerCase(), parseTokenAmount("48", "ETH")]
        );
        merkleTree.addLeaf(leaf1);

        let leaf2 : any = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [userSigners[3].address, WETH_ADDRESS.toLowerCase(), parseTokenAmount("33", "ETH")]
        );
  
        merkleTree.addLeaf((leaf2));
        await (await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY)).wait();
        await ethgasRebateAsBookKeeper.endRestrictedMode();

        let proof = merkleTree.getHexProof(leaf1);
  
        // First claim should succeed
        await (await ethgasRebate.connect(userSigners[2]).claimReward(
          [
            {user: userSigners[2].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("48", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )).wait();

        await network.provider.request({method:"evm_increaseTime", params:[ 86400 + 1 ]});
        await network.provider.request({method:"evm_mine", params:[ ]});

        proof = merkleTree.getHexProof(leaf2);
    
        await expect(
          ethgasRebate.connect(userSigners[3]).claimReward(
            [
              {user: userSigners[3].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("33", "ETH")}
            ],
            [WETH_ADDRESS],           
            proof,
            GAS_REBATE_CATEGORY,
            false,
            0
         )
        ).to.be.revertedWith("RewardPoolOutOfFunds");

    });

    it("Should revert when merkleRoot is not set", async function () {
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      // Deploy new contract instance to ensure merkleRoot is zero
      const EthgasRebate = await ethers.getContractFactory("EthgasRebate");
      const placeholderAddress = WETH_ADDRESS;
      const newRebate = await EthgasRebate.deploy(aclManager.address, supportedTokensArr, dailyWithdrawalCapArr, WETH_ADDRESS, placeholderAddress, placeholderAddress);
      
      await expect(
        newRebate.connect(userSigners[0]).claimReward(
          [
            {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
          ], 
          [WETH_ADDRESS],
          [],
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("InvalidProof");
    });

    it("Should handle multiple token claims in single transaction", async function () {
      // Setup second token
      const TestERC20 = await ethers.getContractFactory("TestERC20");
      const token2 = await TestERC20.deploy(parseTokenAmount("10000", "USDC"));
      await token2.mint(ethgasRebate.address, parseTokenAmount("100", "USDC"));

      // Set daily withdrawal cap for token2
      await ((await ethgasRebate.connect(contractAdminSigner).setDailyWithdrawalCap([token2.address], [parseTokenAmount("50", "USDC")]))).wait()

      // Create merkle tree with multiple tokens and users
      const leaves = [
        ethers.utils.solidityKeccak256(
          ["uint256"],
          [Math.floor((new Date).getTime() / 1000)]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256", "address", "address", "uint256"],
          [userSigners[0].address, wethToken.address, parseTokenAmount("1", "ETH"), userSigners[0].address, token2.address, parseTokenAmount("2", "USDC"),]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256", "address", "address", "uint256"],
          [userSigners[1].address, wethToken.address, parseTokenAmount("3", "ETH"), userSigners[1].address, token2.address, parseTokenAmount("4", "USDC"),]
        )
      ]

      await ethgasRebateAsBookKeeper.startRestrictedMode();

      
      const multiTokenTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      await ethgasRebateAsBookKeeper.updateMerkleRoot(multiTokenTree.getHexRoot(), GAS_REBATE_CATEGORY);

      // Get proofs for user0 and user1
      const user0Proofs = multiTokenTree.getHexProof(leaves[1]);
      const user1Proofs = multiTokenTree.getHexProof(leaves[2]);

      //starting zero balance
      expect(await wethToken.balanceOf(userSigners[0].address)).to.equal(0); 
      expect(await token2.balanceOf(userSigners[0].address)).to.equal(0);
      expect(await wethToken.balanceOf(userSigners[1].address)).to.equal(0); 
      expect(await token2.balanceOf(userSigners[1].address)).to.equal(0);
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      // User0 claims
      let tx = await ethgasRebate.connect(userSigners[0]).claimReward(
        [
          {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")},
          {user: userSigners[0].address, token: token2.address, claimAmount: parseTokenAmount("2", "USDC")}
        ],
        [token2.address, WETH_ADDRESS],
        user0Proofs,
        GAS_REBATE_CATEGORY,
        false,
        0
      )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(userSigners[0].address, wethToken.address, parseTokenAmount("1", "ETH"))
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(userSigners[0].address, token2.address, parseTokenAmount("2", "USDC"));

      // User1 claims
      tx = await ethgasRebate.connect(userSigners[1]).claimReward(
        [
          {user: userSigners[1].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("3", "ETH")},
          {user: userSigners[1].address, token: token2.address, claimAmount: parseTokenAmount("4", "USDC")}
        ],
        [WETH_ADDRESS, token2.address],
        user1Proofs,
        GAS_REBATE_CATEGORY,
        false,
        0
      )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(userSigners[1].address, wethToken.address, parseTokenAmount("3", "ETH"))
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(userSigners[1].address, token2.address, parseTokenAmount("4", "USDC"));

      expect(await wethToken.balanceOf(userSigners[0].address)).to.equal(parseTokenAmount("1", "ETH")); 
      expect(await token2.balanceOf(userSigners[0].address)).to.equal(parseTokenAmount("2", "USDC"));
      expect(await wethToken.balanceOf(userSigners[1].address)).to.equal(parseTokenAmount("3", "ETH")); 
      expect(await token2.balanceOf(userSigners[1].address)).to.equal(parseTokenAmount("4", "USDC"));
    })

    it("Should handle primary and multiple sub-wallets and multiple token claims in single transaction", async function () {
      // Set daily withdrawal cap for USDT
      await ((await ethgasRebate.connect(contractAdminSigner).setDailyWithdrawalCap([USDT_ADDRESS], [parseTokenAmount("100", "USDT")]))).wait()

      await ethgasRebateAsBookKeeper.endRestrictedMode();
      const user1Address = await userSigners[1].getAddress();
      const user2Address = await userSigners[2].getAddress();
      const user3Address = await userSigners[3].getAddress();
      const ethAmount = parseTokenAmount("1.5", "ETH");
      const ethAmount2 = parseTokenAmount("2", "ETH");
      const usdtAmount = parseTokenAmount("10.5", "USDT");
      const usdtAmount2 = parseTokenAmount("22", "USDT");
      const usdtAmount3 = parseTokenAmount("33", "USDT");
      //starting zero balance
      expect(await wethToken.balanceOf(user1Address)).to.equal(0); 
      expect(await usdtToken.balanceOf(user1Address)).to.equal(0);
      expect(await wethToken.balanceOf(user2Address)).to.equal(0); 
      expect(await usdtToken.balanceOf(user2Address)).to.equal(0);
      expect(await wethToken.balanceOf(user3Address)).to.equal(0); 
      expect(await usdtToken.balanceOf(user3Address)).to.equal(0);
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256", "address", "address", "uint256"],
        [
          user1Address, WETH_ADDRESS, ethAmount, 
          user2Address, WETH_ADDRESS, ethAmount2,
          user1Address, USDT_ADDRESS, usdtAmount, 
          user2Address, USDT_ADDRESS, usdtAmount2, 
          user3Address, USDT_ADDRESS, usdtAmount3
        ]
      );
      const proof = merkleTree.getHexProof(leaf);
      let tx = await ethgasRebate.connect(userSigners[1]).claimReward(
          [
            {user: user1Address, token: WETH_ADDRESS, claimAmount: ethAmount},
            {user: user2Address, token: WETH_ADDRESS, claimAmount: ethAmount2},
            {user: user1Address, token: USDT_ADDRESS, claimAmount: usdtAmount},
            {user: user2Address, token: USDT_ADDRESS, claimAmount: usdtAmount2},
            {user: user3Address, token: USDT_ADDRESS, claimAmount: usdtAmount3},
          ],
          [WETH_ADDRESS, USDT_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(user1Address, WETH_ADDRESS, ethAmount.add(ethAmount2))
      await expect(tx).to.emit(ethgasRebate, "RewardClaimed").withArgs(user1Address, USDT_ADDRESS, usdtAmount.add(usdtAmount2).add(usdtAmount3));
      expect(await wethToken.balanceOf(user1Address)).to.equal(ethAmount.add(ethAmount2));
      expect(await usdtToken.balanceOf(user1Address)).to.equal(usdtAmount.add(usdtAmount2).add(usdtAmount3));
      expect(await wethToken.balanceOf(user2Address)).to.equal(0); 
      expect(await usdtToken.balanceOf(user2Address)).to.equal(0);
      expect(await wethToken.balanceOf(user3Address)).to.equal(0); 
      expect(await usdtToken.balanceOf(user3Address)).to.equal(0);
    });

    it("Should revert claim when restricted mode on", async function () {
      await ethgasRebateAsBookKeeper.startRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.be.revertedWith("RestrictedModeOn");
    });

    it("Should revert update merkle root when restricted mode off", async function () {
      const root = merkleTree.getHexRoot();
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      await expect(
        ethgasRebateAsBookKeeper.updateMerkleRoot(root, GAS_REBATE_CATEGORY)
      ).to.be.revertedWith("RestrictedModeOff");
    });

    it("Should revert update merkle root if merkle root is zero", async function () {
      const root = "0x0000000000000000000000000000000000000000000000000000000000000000";
      await expect(
        ethgasRebateAsBookKeeper.updateMerkleRoot(root, GAS_REBATE_CATEGORY)
      ).to.be.revertedWith("InvalidMerkleRoot");
    });

  });


  describe("Claim and Stake", ()=>{
    it("user cannot refuse to stake if staking is required for the merkle tree category", async function () {
      await (await ethgasRebateAsBookKeeper["deposit()"]({value: parseTokenAmount("0.52", "ETH")})).wait();
      await ethgasRebateAsBookKeeper.startRestrictedMode();
      const user0Address = await userSigners[0].getAddress();
      const airdropAmount = parseTokenAmount("0.52", "ETH");
      const airdropleaves = [
        ethers.utils.solidityKeccak256(
          ["uint256"],
          [Math.floor(Math.random() * 100000)]
        ),
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user0Address, WETH_ADDRESS, airdropAmount]
        )
      ]
      const sevenDaysInSec = 3600 * 24 * 7
      const airdropMerkleTree = new MerkleTree(airdropleaves, keccak256, { sortPairs: true });
      await ethgasRebateAsBookKeeper.updateMerkleRoot(airdropMerkleTree.getHexRoot(), AIRDROP_CATEGORY);
      await expect(ethgasRebateAsBookKeeper.updateMerkleRootInfo(true, sevenDaysInSec, AIRDROP_CATEGORY))
        .to.emit(ethgasRebate, "MerkleRootInfoUpdated")
        .withArgs(true, sevenDaysInSec, AIRDROP_CATEGORY);
      await ethgasRebateAsBookKeeper.endRestrictedMode();
      
      const proof = airdropMerkleTree.getHexProof(airdropleaves[1]);
      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: user0Address, token: WETH_ADDRESS, claimAmount: airdropAmount}
          ],
          [WETH_ADDRESS],
          proof,
          AIRDROP_CATEGORY,
          false,
          sevenDaysInSec
        )
      ).to.be.revertedWith("StakeRequired");
    });
  })


  describe("Deposit Functions", ()=>{
    it("Deposit ERC20 tokens", async () => {
      // get WETH token
      await(await (wethToken.connect(bookKeeperSigner).deposit({value: parseTokenAmount("70", "ETH")}))).wait();
      //Previously successful withlist is revoked
      await (await wethToken.connect(bookKeeperSigner).approve(ethgasRebate.address, parseTokenAmount("70", "ETH"))).wait();
      await expect(ethgasRebateAsBookKeeper["deposit(address[],uint256[])"]([WETH_ADDRESS],[parseTokenAmount("70", "ETH")])).to.emit(ethgasRebate, "Deposit").withArgs(WETH_ADDRESS, bookKeeperSigner.address, parseTokenAmount("70", "ETH"));
      expect(await wethToken.balanceOf(ethgasRebate.address)).to.equal(parseTokenAmount("70", "ETH"));
    });

    it("Deposit multiple ERC20 tokens", async () => {
      expect(await wethToken.balanceOf(ethgasRebate.address)).to.equal(0);
      expect(await usdtToken.balanceOf(ethgasRebate.address)).to.equal(0);
      // get WETH token
      await(await (wethToken.connect(bookKeeperSigner).deposit({value: parseTokenAmount("70", "ETH")}))).wait();
      //Previously successful withlist is revoked
      await (await wethToken.connect(bookKeeperSigner).approve(ethgasRebate.address, parseTokenAmount("70", "ETH"))).wait();

      let walletAddress = addressObj["USDT"]["impersonate_holder_address"];
      let sendAmount = parseTokenAmount(tokensConfigObj["USDT"]["test_fund_transfer_amount"].toString(), "USDT");
      await network.provider.request({method: "hardhat_impersonateAccount", params: [ walletAddress ]});
      let walletSigner = await ethers.getSigner(walletAddress);
      await ( await usdtToken.connect(walletSigner).transfer(bookKeeperSigner.address, sendAmount) ).wait();
      await ( await usdtToken.connect(bookKeeperSigner).approve(ethgasRebate.address, sendAmount) ).wait();
      
      let tx = await ethgasRebateAsBookKeeper["deposit(address[],uint256[])"]([WETH_ADDRESS, USDT_ADDRESS],[parseTokenAmount("70", "ETH"), parseTokenAmount("10.2", "USDT")])
      await expect(tx).to.emit(ethgasRebate, "Deposit").withArgs(WETH_ADDRESS, bookKeeperSigner.address, parseTokenAmount("70", "ETH"))
      await expect(tx).to.emit(ethgasRebate, "Deposit").withArgs(USDT_ADDRESS, bookKeeperSigner.address, parseTokenAmount("10.2", "USDT"))
      expect(await wethToken.balanceOf(ethgasRebate.address)).to.equal(parseTokenAmount("70", "ETH"));
      expect(await usdtToken.balanceOf(ethgasRebate.address)).to.equal(parseTokenAmount("10.2", "USDT"));
    });
  })

  describe("Pausing contracts", ()=>{
    beforeEach(async function () {
      await ethgasRebateAsBookKeeper.startRestrictedMode();
        // Set merkle root
        await ethgasRebateAsBookKeeper.updateMerkleRoot(merkleTree.getHexRoot(), GAS_REBATE_CATEGORY);
        
        // Fund the contract with tokens
        await (await ethgasRebateAsBookKeeper["deposit()"]({value: parseTokenAmount("70", "ETH")})).wait();

        await (await ethgasRebate.connect(pauserSigner).pause()).wait();
      });

      it("pauser cannot unpause contract", async () => {
        await expect(ethgasRebate.connect(pauserSigner).unpause()).to.be.revertedWith("AccessControl: account " +  pauserSigner.address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE);
      })
  
      it("Claim reward is paused", async () => {
        //unable to claim even with valid proof
        const user0Address = await userSigners[0].getAddress();
        const amount = parseTokenAmount("1", "ETH");
        
        expect(await wethToken.balanceOf(user0Address)).to.equal(0); //starting zero balance
        const leaf = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user0Address, WETH_ADDRESS, amount]
        );
        const proof = merkleTree.getHexProof(leaf);
  
        await expect(
            ethgasRebate.connect(userSigners[0]).claimReward(
              [
                {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.be.revertedWith("EnforcedPause()");
        expect(await wethToken.balanceOf(user0Address)).to.equal(0);
      });

      it("Claim can be conducted after unpause", async () => {
        //Claim can proceed after unpause
        await (await ethgasRebate.connect(contractAdminSigner).unpause()).wait();
        const user0Address = await userSigners[0].getAddress();
        const amount = parseTokenAmount("1", "ETH");
        
        expect(await wethToken.balanceOf(user0Address)).to.equal(0); //starting zero balance
        const leaf = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user0Address, WETH_ADDRESS, amount]
        );
        const proof = merkleTree.getHexProof(leaf);
        await ethgasRebateAsBookKeeper.endRestrictedMode();
        await expect(
            ethgasRebate.connect(userSigners[0]).claimReward(
              [
                {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
              ],
              [WETH_ADDRESS],
              proof,
              GAS_REBATE_CATEGORY,
              false,
              0
            )
          ).to.emit(ethgasRebate, "RewardClaimed")
           .withArgs(user0Address, wethToken.address, amount);
    
          expect(await wethToken.balanceOf(user0Address)).to.equal(amount);
        
      });

      

    });
  
  describe("Admin Functions", ()=>{
    it("Set Restricted Mode", async () => {
      await expect(ethgasRebate.connect(contractAdminSigner).startRestrictedMode()).to.emit(ethgasRebate, "RestrictedModeUpdated").withArgs(true);
      const root = merkleTree.getHexRoot();
      
      await expect(ethgasRebateAsBookKeeper.updateMerkleRoot(root, GAS_REBATE_CATEGORY))
        .to.emit(ethgasRebate, "MerkleRootUpdated")
        .withArgs(root, GAS_REBATE_CATEGORY);

      expect(await ethgasRebate.merkleRoot(GAS_REBATE_CATEGORY)).to.equal(root);
      await ethgasRebateAsBookKeeper.endRestrictedMode();

      await expect(
        ethgasRebateAsBookKeeper.updateMerkleRoot(root, GAS_REBATE_CATEGORY)
      ).to.be.revertedWith("RestrictedModeOff");

      

      //try to claim
      await (await ethgasRebateAsBookKeeper["deposit()"]({value: parseTokenAmount("70", "ETH")})).wait();
      const user0Address = await userSigners[0].getAddress();
      const amount = parseTokenAmount("1", "ETH");
      
      expect(await wethToken.balanceOf(user0Address)).to.equal(0); //starting zero balance
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [user0Address, WETH_ADDRESS, amount]
      );
      let proof = merkleTree.getHexProof(leaf);

      await expect(
        ethgasRebate.connect(userSigners[0]).claimReward(
          [
            {user: userSigners[0].address, token: WETH_ADDRESS, claimAmount: parseTokenAmount("1", "ETH")}
          ],
          [WETH_ADDRESS],
          proof,
          GAS_REBATE_CATEGORY,
          false,
          0
        )
      ).to.emit(ethgasRebate, "RewardClaimed")
       .withArgs(user0Address, wethToken.address, amount);

      expect(await wethToken.balanceOf(user0Address)).to.equal(amount);


    });

    it("Set Depsoit Whitelist", async () => {
      //Previously successful withlist is revoked
      await expect(ethgasRebate.connect(contractAdminSigner).setDepositorWhitelist([bookKeeperSigner.address], [false])).to.emit(ethgasRebate, "DepositWhitelistStatusChanged").withArgs(bookKeeperSigner.address, false);
      //unable to deposit now. 
      await expect(ethgasRebateAsBookKeeper["deposit()"]({value: parseTokenAmount("70", "ETH")})).to.be.revertedWith("DepositNotAllowed()");

      const INIT_BALANCE = await wethToken.balanceOf(ethgasRebate.address)
      await ethgasRebate.connect(contractAdminSigner).setDepositorWhitelist([contractAdminSigner.address, bookKeeperSigner.address], [true, true])
      await ethgasRebate.connect(contractAdminSigner)["deposit()"]({value: parseTokenAmount("1.1", "ETH")})
      await ethgasRebate.connect(bookKeeperSigner)["deposit()"]({value: parseTokenAmount("1.3", "ETH")})
      const END_BALANCE = await wethToken.balanceOf(ethgasRebate.address)
      expect(END_BALANCE.sub(INIT_BALANCE)).to.eq(parseTokenAmount("2.4", "ETH"))
    });

    it("admin can update daily withdrawal caps in batch", async () => {
      const wethCap = parseTokenAmount("50", "WETH");
      const usdtCap = parseTokenAmount("100", "USDT");

      const tx = await ethgasRebate.connect(contractAdminSigner).setDailyWithdrawalCap(
        [WETH_ADDRESS, USDT_ADDRESS],
        [wethCap, usdtCap]
      );

      await expect(tx).to.emit(ethgasRebate, "DailyWithdrawalCapChanged").withArgs(WETH_ADDRESS, wethCap);
      await expect(tx).to.emit(ethgasRebate, "DailyWithdrawalCapChanged").withArgs(USDT_ADDRESS, usdtCap);
      expect(await ethgasRebate.dailyWithdrawalCap(WETH_ADDRESS)).to.eq(wethCap);
      expect(await ethgasRebate.dailyWithdrawalCap(USDT_ADDRESS)).to.eq(usdtCap);
    });

    it("admin cannot update daily withdrawal caps with mismatched array lengths", async () => {
      await expect(
        ethgasRebate.connect(contractAdminSigner).setDailyWithdrawalCap(
          [WETH_ADDRESS],
          [parseTokenAmount("50", "WETH"), parseTokenAmount("100", "USDT")]
        )
      ).to.be.revertedWith("InvalidArrayLength")
    });

    it('non-admin cannot update daily withdrawal cap', async () => {
      await expect(
        ethgasRebateAsBookKeeper.setDailyWithdrawalCap([WETH_ADDRESS], [parseTokenAmount("50", "WETH")])
      ).to.be.revertedWith("AccessControl")
    });

    it("withdraw funds", async () => {
      const wethWithdrawAmount = parseTokenAmount("70", "WETH");
      const usdtWithdrawAmount = parseTokenAmount("10.2", "USDT");

      await (await ethgasRebateAsBookKeeper["deposit()"]({value: wethWithdrawAmount})).wait();
      let walletAddress = addressObj["USDT"]["impersonate_holder_address"];
      let sendAmount = parseTokenAmount(tokensConfigObj["USDT"]["test_fund_transfer_amount"].toString(), "USDT");
      await network.provider.request({method: "hardhat_impersonateAccount", params: [ walletAddress ]});
      let walletSigner = await ethers.getSigner(walletAddress);
      await ( await usdtToken.connect(walletSigner).transfer(bookKeeperSigner.address, sendAmount) ).wait();
      await ( await usdtToken.connect(bookKeeperSigner).approve(ethgasRebate.address, usdtWithdrawAmount) ).wait();
      await (await ethgasRebateAsBookKeeper["deposit(address[],uint256[])"]([USDT_ADDRESS], [usdtWithdrawAmount])).wait();

      const INIT_BALANCE = await wethToken.balanceOf(ethgasRebate.address)
      const INIT_USDT_BALANCE = await usdtToken.balanceOf(ethgasRebate.address)
      const INIT_ADMIN_BALANCE = await wethToken.balanceOf(contractAdminSigner.address)
      const INIT_ADMIN_USDT_BALANCE = await usdtToken.balanceOf(contractAdminSigner.address)
      const tx = await ethgasRebate.connect(contractAdminSigner).adminWithdraw(
        [WETH_ADDRESS, USDT_ADDRESS],
        [wethWithdrawAmount, usdtWithdrawAmount],
        contractAdminSigner.address
      )
      await expect(tx).to.emit(ethgasRebate, "Withdrawal").withArgs(WETH_ADDRESS, wethWithdrawAmount, contractAdminSigner.address)
      await expect(tx).to.emit(ethgasRebate, "Withdrawal").withArgs(USDT_ADDRESS, usdtWithdrawAmount, contractAdminSigner.address)
      const END_BALANCE = await wethToken.balanceOf(ethgasRebate.address)
      const END_USDT_BALANCE = await usdtToken.balanceOf(ethgasRebate.address)
      const END_ADMIN_BALANCE = await wethToken.balanceOf(contractAdminSigner.address)
      const END_ADMIN_USDT_BALANCE = await usdtToken.balanceOf(contractAdminSigner.address)
      expect(INIT_BALANCE.sub(END_BALANCE)).to.eq(wethWithdrawAmount)
      expect(INIT_USDT_BALANCE.sub(END_USDT_BALANCE)).to.eq(usdtWithdrawAmount)
      expect(END_ADMIN_BALANCE.sub(INIT_ADMIN_BALANCE)).to.eq(wethWithdrawAmount)
      expect(END_ADMIN_USDT_BALANCE.sub(INIT_ADMIN_USDT_BALANCE)).to.eq(usdtWithdrawAmount)
    });

    it('non-admin cannot withdraw fund', async () => {
      await expect(
        ethgasRebateAsBookKeeper.adminWithdraw(
          [WETH_ADDRESS],
          [parseTokenAmount("70", "WETH")],
          contractAdminSigner.address
        )
      ).to.be.revertedWith("AccessControl")
    });

    it('admin withdraw reverts when array lengths mismatch', async () => {
      await expect(
        ethgasRebate.connect(contractAdminSigner).adminWithdraw(
          [WETH_ADDRESS],
          [parseTokenAmount("70", "WETH"), parseTokenAmount("1", "WETH")],
          contractAdminSigner.address
        )
      ).to.be.reverted
    });

    it('admin withdraw reverts when receiver is zero address', async () => {
      await expect(
        ethgasRebate.connect(contractAdminSigner).adminWithdraw(
          [WETH_ADDRESS],
          [parseTokenAmount("70", "WETH")],
          constants.AddressZero
        )
      ).to.be.reverted
    });

    it("admin approve emits events and updates allowances", async () => {
      const spender = userSigners[0].address;
      const wethApprovalAmount = parseTokenAmount("12.3", "WETH");
      const usdtApprovalAmount = parseTokenAmount("45.6", "USDT");

      expect(await wethToken.allowance(ethgasRebate.address, spender)).to.eq(0);
      expect(await usdtToken.allowance(ethgasRebate.address, spender)).to.eq(0);

      const tx = await ethgasRebate.connect(contractAdminSigner).adminApprove(
        [WETH_ADDRESS, USDT_ADDRESS],
        [wethApprovalAmount, usdtApprovalAmount],
        spender
      );

      await expect(tx).to.emit(ethgasRebate, "AdminApproval").withArgs(WETH_ADDRESS, wethApprovalAmount, spender);
      await expect(tx).to.emit(ethgasRebate, "AdminApproval").withArgs(USDT_ADDRESS, usdtApprovalAmount, spender);
      expect(await wethToken.allowance(ethgasRebate.address, spender)).to.eq(wethApprovalAmount);
      expect(await usdtToken.allowance(ethgasRebate.address, spender)).to.eq(usdtApprovalAmount);
    });

    it("non-admin cannot approve funds", async () => {
      await expect(
        ethgasRebateAsBookKeeper.adminApprove(
          [WETH_ADDRESS],
          [parseTokenAmount("70", "WETH")],
          userSigners[0].address
        )
      ).to.be.revertedWith("AccessControl")
    });

    it("admin approve reverts when array lengths mismatch", async () => {
      await expect(
        ethgasRebate.connect(contractAdminSigner).adminApprove(
          [WETH_ADDRESS],
          [parseTokenAmount("70", "WETH"), parseTokenAmount("1", "WETH")],
          userSigners[0].address
        )
      ).to.be.revertedWith("InvalidArrayLength")
    });

  });

  describe('Timelock controlled functions', () => {
    it('timelock can update ACLManager address', async () => {
      let { deployerFoundation, contractAdminFoundation, pauserFoundation, treasurerFoundation, bookKeeperFoundation } = await getNamedAccounts();
      const { deploy } = deployments;
      let timelockCtrlDeploy = await deployments.get('TimelockControllerFoundation');
      const newACLManager = await deploy('ACLManagerNew', { 
        from: deployerFoundation, log: true, autoMine: true,
        contract: 'ACLManager',
        args: [ contractAdminFoundation, treasurerFoundation, timelockCtrlDeploy.address, [ pauserFoundation ], bookKeeperFoundation, treasurerFoundation ],
      });
      await (await timelockCtrl.connect(proposerSigner).schedule(
        ethgasRebate.address, 0, ethgasRebateInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        ethgasRebate.address, 0, ethgasRebateInterface.encodeFunctionData("setAclManager", [newACLManager.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      expect(await ethgasRebate.aclManager()).to.eq(newACLManager.address);
    });

    it('non-timelock cannot update ACLManager address', async () => {
      let { deployerFoundation, contractAdminFoundation, pauserFoundation, treasurerFoundation, bookKeeperFoundation } = await getNamedAccounts();
      const { deploy } = deployments;
      let timelockCtrlDeploy = await deployments.get('TimelockControllerFoundation');
      const newACLManager = await deploy('ACLManagerNewNT', { 
        from: deployerFoundation, log: true, autoMine: true,
        contract: 'ACLManager',
        args: [ contractAdminFoundation, treasurerFoundation, timelockCtrlDeploy.address, [ pauserFoundation ], bookKeeperFoundation, treasurerFoundation ],
      });
      await expect(ethgasRebateAsBookKeeper.setAclManager(newACLManager.address)).to.be.revertedWith("AccessControl")
    });

  });


});
