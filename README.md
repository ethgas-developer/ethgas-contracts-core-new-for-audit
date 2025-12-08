# Pre-requisite
- recommend to use Node.js version 18.15.0
- run `npm install --legacy-peer-deps`
- clone `.env.example` as `.env` and fill in variable values

# Deploy
- run `npx hardhat deploy` to deploy on implicit local hardhat network
    - run `npx hardhat deploy --tags EthgasSetup,EthgasPool` to deploy certain contracts only where `tags` refer to `func.tags` in deployment scripts
- if there is compilation error, try to run `rm -rf artifacts cache`

# Run unit tests
- run `npx hardhat test` for all tests
- run `npx hardhat test test/<test filename>` for a specific test
- run `npx hardhat test test/<test filename> --v` for more debug message (up to 4 `v`, refer to https://www.npmjs.com/package/hardhat-tracer)
- run `npx hardhat coverage` to check test coverage
- run `slither .` to check for security issues
- for `EthgasRebateToVeStaking.test.ts`, `EthgasTokenLockToVeStaking.test.ts` or `RewardDistributionToVeHolder.test.ts`, run
```
rm -rf deployments/local && npx hardhat node --no-deploy
npx hardhat deploy --tags EthgasSetup,EthgasPool,EthgasToken --network local
# switch to ethgas-contracts-dao repo
# make sure the token address is correct in ethgas-contracts-dao/scripts/deployment/deployment_config.py
brownie run deployment/deploy_dao live_part_one --network hardhat
npx hardhat test test/<EthgasRebateToVeStaking or EthgasTokenLockToVeStaking or RewardDistributionToVeHolder>.test.ts --network local
```

# Contract Verification
- update etherescan api in hardhat.config.ts
- run `npx hardhat run scripts/verify.ts --network mainnet_prod` for all tests

# Debug
- re-run the test if it throws error during the first time
- for vesting related tests, move schedule to the future under `test/lock_config.ts`

# Mainnet TGE deployment procedures
- create `helpers/token-config/tokenLock-mainnet_prod.csv` and ensure it is properly configured
- ensure `helpers/config/mainnet_prod.json` is properly configured
- run
```
npx hardhat deploy --tags EthgasToken --network mainnet_prod
```
- switch to `ethgas-contracts-dao` repo
    - ensure `scripts/deployment/deployment_config.py` is properly configured, especially update the `token` address from the newly deployed contract above
    - run
    ```
    brownie run deployment/deploy_dao live_part_one --network mainnet
    ```
- switch back to this repo
- ensure `helpers/address/mainnet.json` is properly configured, especially update addresses of `GWEI`, `VEGWEI`, `feeDistributor` from the newly deployed contracts above
- ensure addresses under `deployments/mainnet_prod` are properly configured especially `EthgasToken` & `ACLManager`
- run below to deploy the rest
```
npx hardhat deploy --tags EthgasTokenLock --network mainnet_prod
npx hardhat deploy --tags EthgasRebate --network mainnet_prod
npx hardhat deploy --tags BatchTransferFund --network mainnet_prod
```
- run below scripts to verify contracts source code on Etherscan
```
npx hardhat run scripts/verifyTokenLock.ts --network mainnet_prod
npx hardhat run scripts/verifyTge.ts --network mainnet_prod
```
- manually copy and paste vyper code on Etherscan
- run below to list out hex data to create transactions for MPCVault admin
```
npx hardhat run scripts/tge-operations.ts --network mainnet_prod
```