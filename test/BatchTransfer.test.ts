import { expect } from "chai";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BatchTransfer, EthgasToken } from "../typechain";
import { BatchTransfer__factory } from "../typechain/factories/BatchTransfer__factory";
import { EthgasToken__factory } from "../typechain/factories/EthgasToken__factory";

describe("BatchTransfer", function () {
  let batchTransfer: BatchTransfer;
  let ethgasToken: EthgasToken;
  let deployer: SignerWithAddress;
  let recipient1: SignerWithAddress;
  let recipient2: SignerWithAddress;
  let treasury: SignerWithAddress;
  const totalMintedAmount = ethers.utils.parseEther("1000");

  beforeEach(async function () {
    [deployer, recipient1, recipient2, treasury] = await ethers.getSigners();

    ethgasToken = await new EthgasToken__factory(deployer).deploy(
      "ETHGas",
      "EthgasToken",
      deployer.address,
      totalMintedAmount
    );
    await ethgasToken.deployed();

    // Deploy BatchTransfer contract
    batchTransfer = await new BatchTransfer__factory(deployer).deploy();
    await batchTransfer.deployed();
  });

  it("sets the correct owner", async function () {
    expect(await batchTransfer.owner()).to.equal(deployer.address);
  });

  it("reverts if non-owner calls batchTransferToken", async function () {
    await expect(
      batchTransfer
        .connect(recipient1)
        .batchTransferToken(ethgasToken.address, [recipient1.address], [1])
    ).to.be.revertedWith("Only owner");
  });

  it("can batch transfer tokens to multiple recipients with correct amounts", async function () {
    expect(await ethgasToken.totalSupply()).to.equal(totalMintedAmount);
    const recipients = [recipient1.address, recipient2.address, treasury.address];
    const amounts = [
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("200"),
      ethers.utils.parseEther("700"), // remaining to treasury
    ];

    // Approve BatchTransfer to spend deployer's tokens
    await ethgasToken.approve(batchTransfer.address, ethers.utils.parseEther("1000"));

    // Execute batch transfer
    const tx = await batchTransfer.batchTransferToken(ethgasToken.address, recipients, amounts);
    await expect(tx)
      .to.emit(ethgasToken, "Transfer")
      .withArgs(deployer.address, recipient1.address, amounts[0]);

    await expect(tx)
      .to.emit(ethgasToken, "Transfer")
      .withArgs(deployer.address, recipient2.address, amounts[1]);

    await expect(tx)
      .to.emit(ethgasToken, "Transfer")
      .withArgs(deployer.address, treasury.address, amounts[2]);

    // Check balances
    expect(await ethgasToken.balanceOf(recipient1.address)).to.equal(amounts[0]);
    expect(await ethgasToken.balanceOf(recipient2.address)).to.equal(amounts[1]);
    expect(await ethgasToken.balanceOf(treasury.address)).to.equal(amounts[2]);
    expect(await ethgasToken.balanceOf(deployer.address)).to.equal(0);
    expect(await ethgasToken.balanceOf(batchTransfer.address)).to.equal(0);
    expect(await ethgasToken.totalSupply()).to.equal(totalMintedAmount);
  });

  it("reverts if recipients and amounts length mismatch", async function () {
    await expect(
      batchTransfer.batchTransferToken(ethgasToken.address, [recipient1.address], [100, 200])
    ).to.be.revertedWith("Length mismatch");
  });

  it("reverts if transferFrom fails", async function () {
    // No approval given
    await expect(
      batchTransfer.batchTransferToken(
        ethgasToken.address,
        [recipient1.address],
        [ethers.utils.parseEther("1")]
      )
    ).to.be.revertedWith("ERC20InsufficientAllowance");
  });
});
