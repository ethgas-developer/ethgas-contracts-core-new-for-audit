

import { expect } from "chai";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EthgasToken } from "../typechain";
import { EthgasToken__factory } from "../typechain/factories/EthgasToken__factory";

describe("EthgasToken", function () {
  let ethgasToken: EthgasToken;
  let deployer: SignerWithAddress, recipient: SignerWithAddress;

  beforeEach(async function () {
    [deployer, recipient] = await ethers.getSigners();
    ethgasToken = await new EthgasToken__factory(deployer).deploy(
      "ETHGas",
      "EthgasToken",
      deployer.address,
      ethers.utils.parseEther("100000000")
    );
    await ethgasToken.deployed();
  });

  it("has correct name", async function () {
    expect(await ethgasToken.name()).to.equal("ETHGas");
  });

  it("has correct symbol", async function () {
    expect(await ethgasToken.symbol()).to.equal("EthgasToken");
  });

  it("has 18 decimals", async function () {
    expect(await ethgasToken.decimals()).to.equal(18);
  });

  it("assigns total supply to deployer", async function () {
    const totalSupply = await ethgasToken.totalSupply();
    expect(await ethgasToken.balanceOf(deployer.address)).to.equal(totalSupply);
  });

  it("can transfer tokens", async function () {
    const amount = ethers.utils.parseUnits("1000", 18);
    await expect(ethgasToken.transfer(recipient.address, amount))
      .to.emit(ethgasToken, "Transfer")
      .withArgs(deployer.address, recipient.address, amount);

    expect(await ethgasToken.balanceOf(recipient.address)).to.equal(amount);
  });


  it("can approve and transferFrom tokens", async function () {
    const amount = ethers.utils.parseUnits("100", 18);
    await expect(ethgasToken.approve(recipient.address, amount))
      .to.emit(ethgasToken, "Approval")
      .withArgs(deployer.address, recipient.address, amount);

    await ethgasToken.connect(recipient).transferFrom(deployer.address, recipient.address, amount);

    expect(await ethgasToken.balanceOf(recipient.address)).to.equal(amount);
    expect(await ethgasToken.allowance(deployer.address, recipient.address)).to.equal(0);
  });

  it("decreases allowance after transferFrom", async function () {
    const amount = ethers.utils.parseUnits("50", 18);
    await ethgasToken.approve(recipient.address, amount);

    await ethgasToken.connect(recipient).transferFrom(deployer.address, recipient.address, amount);

    expect(await ethgasToken.allowance(deployer.address, recipient.address)).to.equal(0);
  });

  it("reverts transfer if sender has insufficient balance", async function () {
    const amount = ethers.utils.parseUnits("1", 18);
    await expect(
      ethgasToken.connect(recipient).transfer(deployer.address, amount)
    ).to.be.reverted
  });

  it("reverts transferFrom if allowance is insufficient", async function () {
    const amount = ethers.utils.parseUnits("1", 18);
    await expect(
      ethgasToken.connect(recipient).transferFrom(deployer.address, recipient.address, amount)
    ).to.be.reverted
  });

  it("approve emits Approval event", async function () {
    const amount = ethers.utils.parseUnits("10", 18);
    await expect(ethgasToken.approve(recipient.address, amount))
      .to.emit(ethgasToken, "Approval")
      .withArgs(deployer.address, recipient.address, amount);
  });
});