import { BigNumber, utils } from "ethers"

export function formatTokenAmount(amount: BigNumber, tokenName: string): string {
  if (["USDC", "USDT", "AUSDT", "AUSDC"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.formatUnits(amount, 6)
  } else if (["CUSDC", "CUSDT", "CDAI", "CETH", "CWBTC", "WBTC", "AWBTC","LBTC","FBTC","PUMPBTC"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.formatUnits(amount, 8)
  } else if (["GWEI", "DAI", "ETH", "WETH", "ADAI", "AWETH", "STETH","WSTETH","RETH","WEETH","WEETHS","PUFETH","EGETH","MSWETH","MSTETH","USDE","CSTONE","AMPHRETH","PRIMEETH","RSTETH","WSTETH","RE7LRT","LSETH","PZETH","RSETH","STEAKLRT","EZETH","WETH","METH","MWBETH","SWETH","RSWETH"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.formatUnits(amount, 18)
  } else {
    throw Error("invalid token");
  }
}

export function parseTokenAmount(amount: string, tokenName: string): BigNumber {
  if (["USDC", "USDT", "AUSDT", "AUSDC"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.parseUnits(amount, 6)
  } else if (["CUSDC", "CUSDT", "CDAI", "CETH", "CWBTC", "WBTC", "AWBTC","LBTC","FBTC","PUMPBTC"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.parseUnits(amount, 8)
  } else if (["GWEI", "DAI", "ETH", "WETH", "ADAI", "AWETH", "STETH","WSTETH","RETH","WEETH","WEETHS","PUFETH","EGETH","MSWETH","MSTETH","USDE","CSTONE","AMPHRETH","PRIMEETH","RSTETH","WSTETH","RE7LRT","LSETH","PZETH","RSETH","STEAKLRT","EZETH","WETH","METH","MWBETH","SWETH","RSWETH"].indexOf(tokenName.toUpperCase()) !== -1) {
    return utils.parseUnits(amount, 18)
  } else {
    throw Error("invalid token");
  }
}