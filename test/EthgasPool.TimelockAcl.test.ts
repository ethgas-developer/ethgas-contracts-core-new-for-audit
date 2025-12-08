import { ethers, network, waffle, getNamedAccounts, deployments } from "hardhat";
import hre from "hardhat";
const { loadFixture } = waffle;
import { Interface } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { EthgasPool, ACLManager, TimelockController} from '../typechain';
const { DEFAULT_ADMIN_ROLE, TIMELOCK_ROLE, TIMELOCK_ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, TREASURER_ROLE, NATIVE_ETH_ADDRESS } = require(`../helpers/constants`)
const configObj = require(`../helpers/config/` + hre.network.name + `.json`);
const MIN_DELAY_SECS = configObj["TimelockControllerMinDelayInSecond"]
const addressObj = require(`../helpers/address/mainnet.json`);
const WETH_ADDRESS = addressObj["WETH"]["token_address"];
const { parseTokenAmount } = require(`../helpers/utils`)

import chaiAsPromised from 'chai-as-promised';
import chai from "chai";
const { expect } = chai
chai.use(chaiAsPromised);

describe("Timelock", () => {
  let deployerSigner: SignerWithAddress;
  let contractAdminSigner: SignerWithAddress;
  let proposerSigner: SignerWithAddress;
  let userSigners: SignerWithAddress[];
  let pool: EthgasPool;
  let poolAsPauser: EthgasPool;
  let aclManager: ACLManager;
  let timelockCtrl: TimelockController;
  let timelockCtrlInterface: Interface
  let poolInterface: Interface;

  const fixture = async ()=>{
    const { deployer, contractAdmin, treasurer, proposer, pauser, bookKeeper, user0, user1, user2, user3 } = await getNamedAccounts();
    deployerSigner = await ethers.getSigner(deployer);
    contractAdminSigner = await ethers.getSigner(contractAdmin);
    proposerSigner = await ethers.getSigner(proposer);
    let treasurerSigner = await ethers.getSigner(treasurer);
    let bookKeeperSigner = await ethers.getSigner(bookKeeper);
    userSigners = [ 
      await ethers.getSigner(user0), await ethers.getSigner(user1), await ethers.getSigner(user2), await ethers.getSigner(user3) 
    ];
    await deployments.fixture(['EthgasSetup','EthgasPool']);
    const poolDeploy = await deployments.get('EthgasPool');
    pool = await ethers.getContractAt(poolDeploy.abi, poolDeploy.address, contractAdminSigner) as EthgasPool;
    
    poolAsPauser = pool.connect(await ethers.getSigner(pauser));
    const timelockCtrlDeploy = await deployments.get('TimelockController');
    timelockCtrl = await ethers.getContractAt('TimelockController', timelockCtrlDeploy.address) as TimelockController;
    const aclManagerDeploy = await deployments.get('ACLManager');
    aclManager = await ethers.getContractAt('ACLManager', aclManagerDeploy.address) as ACLManager;

    timelockCtrlInterface = new ethers.utils.Interface(timelockCtrlDeploy.abi);
    poolInterface = new ethers.utils.Interface(poolDeploy.abi);

    await pool.connect(bookKeeperSigner).setSupportedToken(WETH_ADDRESS, true);
  }
  beforeEach('load fixture', async()=>{
    await loadFixture(fixture);
    await pool.connect(userSigners[0]).deposit([], {value: parseTokenAmount("10", "ETH")});
  });

  describe('Timelock Role management', () => {

    it(`TimelockController: fail to grant or revoke any role by using deployerSigner, contractAdminSigner, user0`, async () => {
      await expect(timelockCtrl.connect(deployerSigner).grantRole(PROPOSER_ROLE, deployerSigner.address)).to.be.revertedWith(
        "AccessControl: account " +  deployerSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );
      await expect(timelockCtrl.connect(contractAdminSigner).grantRole(EXECUTOR_ROLE, contractAdminSigner.address)).to.be.revertedWith(
        "AccessControl: account " +  contractAdminSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );
      await expect(timelockCtrl.connect(userSigners[0]).grantRole(EXECUTOR_ROLE, userSigners[0].address)).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );

      await expect(timelockCtrl.connect(deployerSigner).revokeRole(TIMELOCK_ADMIN_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  deployerSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );
      await expect(timelockCtrl.connect(contractAdminSigner).revokeRole(TIMELOCK_ADMIN_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  contractAdminSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );
      await expect(timelockCtrl.connect(userSigners[0]).revokeRole(TIMELOCK_ADMIN_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TIMELOCK_ADMIN_ROLE
      );
    })

    it(`TimelockController: can grant or revoke PROPOSER_ROLE`, async () => {
      let encodedData: string = poolInterface.encodeFunctionData("serverTransferAnyFund", [ [userSigners[0].address], [[ {token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH") } ]] ])
      await expect(timelockCtrl.connect(userSigners[0]).schedule(
        timelockCtrl.address, 0, encodedData, 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + ethers.utils.keccak256(ethers.utils.toUtf8Bytes('PROPOSER_ROLE'))
      );

      // grant PROPOSER_ROLE to user0
      await (await timelockCtrl.connect(proposerSigner).schedule(
        timelockCtrl.address, 0, timelockCtrlInterface.encodeFunctionData("grantRole", [PROPOSER_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        timelockCtrl.address, 0, timelockCtrlInterface.encodeFunctionData("grantRole", [PROPOSER_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      // user0 can schedule timelock operation after being granted as PROPOSER_ROLE
      await (await timelockCtrl.connect(userSigners[0]).schedule(
        pool.address, 0, encodedData, 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime",params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine",params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        pool.address, 0, encodedData, 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      // revoke PROPOSER_ROLE from user0
      await (await timelockCtrl.connect(userSigners[0]).schedule(
        timelockCtrl.address, 0, timelockCtrlInterface.encodeFunctionData("revokeRole", [PROPOSER_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        timelockCtrl.address, 0, timelockCtrlInterface.encodeFunctionData("revokeRole", [PROPOSER_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      // user0 cannot schedule timelock operation after being revoked as PROPOSER_ROLE
      await expect(timelockCtrl.connect(userSigners[0]).schedule(
        timelockCtrl.address, 0, encodedData, 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + ethers.utils.keccak256(ethers.utils.toUtf8Bytes('PROPOSER_ROLE'))
      );
    })

    it(`ACLManager: fail to grant or revoke any role by using deployerSigner, contractAdminSigner, user0`, async () => {
      await expect(aclManager.connect(deployerSigner).grantRole(DEFAULT_ADMIN_ROLE, deployerSigner.address)).to.be.revertedWith(
        "AccessControl: account " +  deployerSigner.address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      );
      await expect(aclManager.connect(contractAdminSigner).grantRole(TIMELOCK_ROLE, contractAdminSigner.address)).to.be.revertedWith(
        "AccessControl: account " +  contractAdminSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      );
      await expect(aclManager.connect(userSigners[0]).grantRole(TREASURER_ROLE, userSigners[0].address)).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      );

      await expect(aclManager.connect(deployerSigner).revokeRole(TIMELOCK_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  deployerSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      );
      await expect(aclManager.connect(contractAdminSigner).revokeRole(TIMELOCK_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  contractAdminSigner.address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      );
      await expect(aclManager.connect(userSigners[0]).revokeRole(TIMELOCK_ROLE, timelockCtrl.address)).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      );
    }) 

    it(`ACLManager: can grant or revoke DEFAULT_ADMIN_ROLE`, async () => {
      await poolAsPauser.pause()
      await expect(pool.connect(userSigners[0]).unpause()).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      );
      await aclManager.connect(contractAdminSigner).grantRole(DEFAULT_ADMIN_ROLE, userSigners[0].address)
      await pool.connect(userSigners[0]).unpause()
      await aclManager.connect(contractAdminSigner).revokeRole(DEFAULT_ADMIN_ROLE, userSigners[0].address)
      await poolAsPauser.pause()
      await expect(pool.connect(userSigners[0]).unpause()).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + DEFAULT_ADMIN_ROLE
      );
    })

    it(`ACLManager: can grant or revoke OTHER_ROLEs`, async () => {
      const OTHER_ROLE_1 = "0x0000000000000000000000000000000000000000000000000000000000000006";
      const OTHER_ROLE_2 = "0x0000000000000000000000000000000000000000000000000000000000000007";
      const OTHER_ROLE_3 = "0x0000000000000000000000000000000000000000000000000000000000000008";
      await aclManager.connect(contractAdminSigner).grantRole(OTHER_ROLE_1, userSigners[0].address)
      await aclManager.connect(contractAdminSigner).grantRole(OTHER_ROLE_2, userSigners[1].address)
      await aclManager.connect(contractAdminSigner).grantRole(OTHER_ROLE_3, userSigners[2].address)
      await aclManager.connect(contractAdminSigner).revokeRole(OTHER_ROLE_1, userSigners[0].address)
      await aclManager.connect(contractAdminSigner).revokeRole(OTHER_ROLE_2, userSigners[1].address)
      await aclManager.connect(contractAdminSigner).revokeRole(OTHER_ROLE_3, userSigners[2].address)
    })

    it(`ACLManager: can grant or revoke TIMELOCK_ROLE`, async () => {
      await expect(pool.connect(userSigners[0]).serverTransferAnyFund(
        [userSigners[0].address], [[ {token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH") } ]]
      )).to.be.revertedWith(
        "AccessControl: account " +  userSigners[0].address.toLowerCase() + " is missing role " + TIMELOCK_ROLE
      )

      // grant TIMELOCK_ROLE to user0
      await (await timelockCtrl.connect(proposerSigner).schedule(
        aclManager.address, 0, timelockCtrlInterface.encodeFunctionData("grantRole", [TIMELOCK_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        aclManager.address, 0, timelockCtrlInterface.encodeFunctionData("grantRole", [TIMELOCK_ROLE, userSigners[0].address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      // revoke TIMELOCK_ROLE from TimelockController contract
      await (await timelockCtrl.connect(proposerSigner).schedule(
        aclManager.address, 0, timelockCtrlInterface.encodeFunctionData("revokeRole", [TIMELOCK_ROLE, timelockCtrl.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero, MIN_DELAY_SECS)
      ).wait();

      await network.provider.request({method:"evm_increaseTime", params:[ MIN_DELAY_SECS + 1 ]});
      await network.provider.request({method:"evm_mine", params:[ ]});

      await (await timelockCtrl.connect(contractAdminSigner).execute(
        aclManager.address, 0, timelockCtrlInterface.encodeFunctionData("revokeRole", [TIMELOCK_ROLE, timelockCtrl.address]), 
        ethers.constants.HashZero, ethers.constants.HashZero)
      ).wait();

      // can execute serverTransferAnyFund without timelock
      await pool.connect(userSigners[0]).serverTransferAnyFund(
        [userSigners[0].address], [[ {token: NATIVE_ETH_ADDRESS, amount: parseTokenAmount("1", "ETH") } ]]
      );

    })

  })

})