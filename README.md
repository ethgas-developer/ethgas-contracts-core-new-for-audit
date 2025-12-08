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