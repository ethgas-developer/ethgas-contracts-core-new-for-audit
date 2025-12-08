import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";

import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-deploy";
import "hardhat-tracer";

dotenv.config();

const namedAccounts = {
  deployer: {
    1: `privatekey://${process.env.MAINNET_DEPLOYER_PRIVATE_KEY}`, // mainnet

    default: 0,
    hoodi_prod: `privatekey://${process.env.TESTNET_DEPLOYER_PRIVATE_KEY}`,
    sepolia_temp: `privatekey://${process.env.TESTNET_DEPLOYER_PRIVATE_KEY}`,
    sepolia_prod: `privatekey://${process.env.TESTNET_DEPLOYER_PRIVATE_KEY}`,
    dev_chain: `privatekey://${process.env.TESTNET_DEPLOYER_PRIVATE_KEY}`,
  },
  contractAdmin: {
    1: "0xbA362D164711Df2c8240eA041250D15E8dCe7A63", // mainnet

    default: 1,
    hoodi_prod: `privatekey://${process.env.TESTNET_ADMIN_PRIVATE_KEY}`,
    sepolia_temp: "0xaFA32cfab3bCf84f408fCCaF7908752C481ECBC6",
    dev_chain: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
  },
  treasurer: {
    1: "0x909aA06EaecAbd8B60278bE5Db9d3d573229743b", // mainnet

    default: 2,
    holesky_temp: "0x06111e5791568Ed72E368DF73D5B3126ab3B82E4",
    sepolia_temp: "0x06111e5791568Ed72E368DF73D5B3126ab3B82E4",
    dev_chain: "0x24B1F5A899d923f5e149D404F5F5F50FcE3da904",
  },
  proposer: {
    1: "0xbA362D164711Df2c8240eA041250D15E8dCe7A63", // mainnet

    default: 3,
    holesky_temp: "0xaFA32cfab3bCf84f408fCCaF7908752C481ECBC6",
    sepolia_temp: "0xaFA32cfab3bCf84f408fCCaF7908752C481ECBC6",
    dev_chain: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
  },
  pauser: {
    1: "0x52195c914e0cDe4cEc2759d7079c56da04c13f9b", // mainnet Lok
    
    default: 4,
    holesky_temp: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
    sepolia_temp: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
    dev_chain: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
  },
  pauser1: {
    1: "0x95bf2510d1fB042AEe4996da23911DA16c0bA8b6", // mainnet Calvin
  },
  pauser2: {
    1: "0xC3b5C5a97B032DF44c7f9BFF3cFb64D6A880266F", // mainnet Knucle
  },
  pauser3: {
    1: "0x4A0e4101B9f5d0f5D92F196A9ADCF597AEF63e6C", // mainnet Steve
  },
  bookKeeper: {
    1: "0xbA362D164711Df2c8240eA041250D15E8dCe7A63", // mainnet
    
    default: 5,
    holesky_temp: "0xaFA32cfab3bCf84f408fCCaF7908752C481ECBC6",
    sepolia_temp: "0xaFA32cfab3bCf84f408fCCaF7908752C481ECBC6",
    dev_chain: "0xE4014aC823f84Cb02F1eB16b52aeF85FBBE0e925",
  },
  payouter: {
    1: "0xbCB61AD7B2d7949ecAEfC77Adbd5914813AEeFfa", // mainnet

    default: 6,
    dev_chain: "0x427Bc41A1b406636D7E6f520a054FcA6ccbBfAe5"
  },
  user0: {
    default: 7,
  },
  user1: {
    default: 8,
  },
  user2: {
    default: 9,
  },
  user3: {
    default: 10,
  }
};

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers:[
      {
        version: "0.4.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000
          }
        }
      },
      {version: "0.8.12"},
      {version: "0.8.24"},
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true, // EthgasPool with false and 200 runs
            runs: 20000
          }
        }
      },
    ],
  },
  mocha: {
    timeout: 700000,
  },
  networks: {
    hardhat:{
      gas: 1800000,
      forking:{
        url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        blockNumber: 19900048 // previoulsy 17429599, 16823743
      },
      initialBaseFeePerGas: 10,
      saveDeployments: false,
      tags: ["local"],
    },
    mainnet_prod: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      saveDeployments: true,
      tags: ["mainnet"],
      timeout: 1800000
    },
    mainnet_beta: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      saveDeployments: true,
      tags: ["mainnet"],
      timeout: 1800000
    },
    holesky_testnetapp: {
      url: `https://eth-holesky.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      saveDeployments: true,
      tags: ["testnet", "holesky"],
      timeout: 1800000
    },
    hoodi_prod: {
      url: `https://ethereum-hoodi-rpc.publicnode.com`,
      saveDeployments: true,
      tags: ["testnet", "hoodi"],
      timeout: 1800000
    },
    sepolia_prod: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      saveDeployments: true,
      tags: ["testnet", "sepolia"],
      timeout: 1800000
    },
    dev_chain: {
      url: `http://18.163.215.219:8545`,
      saveDeployments: true,
      tags: ["testnet","dev_chain"],
      timeout: 1800000,
      gasPrice: 50000000000
    },
    dev_pectra: {
      url: `http://16.163.4.133:8545`,
      saveDeployments: true,
      tags: ["testnet","dev_pectra"],
      timeout: 1800000
    },
    sepolia_temp: {
      url: `https://ethereum-sepolia-rpc.publicnode.com`,
      saveDeployments: true,
      tags: ["testnet", "sepolia"],
      timeout: 1800000
    },
    local: {
      url: "http://127.0.0.1:8545/",
      saveDeployments: true,
      tags: ["local"],
      timeout: 1800000
    },

    playground: {
      url: "http://43.199.63.79:8545/",
      saveDeployments: true,
      tags: ["dev"],
      timeout: 1800000,
      chainId: 1337
    },
  },
  namedAccounts,
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  etherscan: {
    apiKey: { 
      mainnet: process.env.ETHERSCAN_API_KEY as string,
      goerli: process.env.ETHERSCAN_API_KEY as string,
      testnet: process.env.ETHERSCAN_API_KEY as string,
      sepolia: process.env.ETHERSCAN_API_KEY as string,
      hoodi: process.env.ETHERSCAN_API_KEY as string,
    },
    customChains: [
      {
        network: "testnet",
        chainId: 17000,
        urls: {
          apiURL: "https://api-holesky.etherscan.io/api" as string,
          browserURL: "https://holesky.etherscan.io/" as string
        }
      },
      {
        network: "hoodi",
        chainId: 560048,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=560048" as string,
          browserURL: "https://hoodi.etherscan.io/" as string
        }
      },
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=11155111" as string,
          browserURL: "https://sepolia.etherscan.io/" as string
        }
      },
      {
        network: "mainnet",
        chainId: 1,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=1" as string,
          browserURL: "https://etherscan.io/" as string
        }
      }
    ]
  },
};

export default config;
