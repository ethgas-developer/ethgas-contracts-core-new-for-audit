import { BigNumber, Contract } from 'ethers'

import { Account, toEthgasToken } from './lock_network'

export interface DateRange {
  startTime: number
  endTime: number
}

const dateRange = (months: number): DateRange => {
  const date = new Date(+new Date() - 120) // set start time for a few seconds before
  const newDate = new Date().setMonth(date.getMonth() + months)
  return { startTime: Math.round(+date / 1000), endTime: Math.round(+newDate / 1000) }
}

const moveTime = (time: number, months: number) => {
  const date = new Date(time * 1000)
  return Math.round(+date.setMonth(date.getMonth() + months) / 1000)
}

const moveDateRange = (dateRange: DateRange, months: number) => {
  return {
    startTime: moveTime(dateRange.startTime, months),
    endTime: moveTime(dateRange.endTime, months),
  }
}

const createSchedule = (
  managedAmount: string,
  unlockPeriods: number,
  unlockStartTime: string,
  unlockEndTime: string,
  initialUnlockAmount: string,
  revocable: boolean,
  vestingPeriods: number,
  vestingCliffTime: string,
  vestingEndTime: string,
  vestingCliffAmount: string
) => {
  return [
    {
      managedAmount: toEthgasToken(managedAmount),
      unlockPeriods,
      unlockStartTime: new Date(unlockStartTime).getTime() / 1000,
      unlockEndTime: new Date(unlockEndTime).getTime() / 1000,
      initialUnlockAmount: toEthgasToken(initialUnlockAmount),
      revocable,
      vestingPeriods,
      vestingCliffTime: new Date(vestingCliffTime).getTime() / 1000,
      vestingEndTime: new Date(vestingEndTime).getTime() / 1000, 
      vestingCliffAmount: toEthgasToken(vestingCliffAmount)
    },
    {
      managedAmount,
      unlockPeriods,
      unlockStartTime,
      unlockEndTime,
      initialUnlockAmount,
      revocable,
      vestingPeriods,
      vestingCliffTime,
      vestingEndTime,
      vestingCliffAmount,
    }
  ]
}

export const createScheduleScenarios = (): Array<Array<any>> => {
  return [
    // fully vested before TGE
    createSchedule(
      "100000",
      18,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "15000",
      true,
      18,
      "2025-01-01T09:00:00Z",
      "2026-07-01T08:59:59Z",
      "15000",
    ),

    // fully vested before TGE with shorter period
    createSchedule(
      "1000",
      12,
      "2025-09-01T09:00:00Z",
      "2026-09-01T08:59:59Z",
      "200",
      true,
      12,
      "2024-05-20T09:00:00Z",
      "2025-05-20T08:59:59Z",
      "200",
    ),

    // vested cliff before TGE
    createSchedule(
      "100000",
      18,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "15000",
      true,
      18,
      "2027-07-01T09:00:00Z",
      "2029-01-01T08:59:59Z",
      "15000",
    ),

    // vested cliff before TGE with different vesting & unlock periods & amount
    createSchedule(
      "100000",
      36,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "20000",
      true,
      18,
      "2027-07-01T09:00:00Z",
      "2029-01-01T08:59:59Z",
      "15000",
    ),

    // no vesting, only unlock
    createSchedule(
      "100000",
      18,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "15000",
      false,
      0,                       // placeholder
      "2000-01-01T00:00:00Z",  // placeholder
      "2000-01-01T00:00:00Z",  // placeholder
      "0",                     // placeholder
    ),

    // no vesting, only unlock but without initial unlock
    createSchedule(
      "5000500",
      48,
      "2027-11-01T00:00:00Z",
      "2031-10-31T23:59:59Z",
      "0",
      false,
      0,                       // placeholder
      "2000-01-01T00:00:00Z",  // placeholder
      "2000-01-01T00:00:00Z",  // placeholder
      "0",                     // placeholder
    ),

    // vesting & unlock schedule are the same, without initial unlock
    createSchedule(
      "100000",
      18,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "0",
      true,
      18,
      "2027-11-01T09:00:00Z",
      "2029-05-01T08:59:59Z",
      "0",
    ),
  ]
}