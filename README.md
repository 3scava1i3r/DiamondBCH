# BCH DeFiHub - Liquid Staking MVP

**One protocol address** coordinating DeFi instruments on Bitcoin Cash using CashTokens and covenants.

## Quick Start

```bash
# Install dependencies
npm install --include=dev

# Compile the contract
npm run compile

# Test on mocknet (like Foundry's Anvil)
npm test

# Deploy to chipnet (requires WIF)
OWNER_WIF=<your-chipnet-wif> npm run deploy

# Stake BCH to receive lstBCH NFT
OWNER_WIF=<wif> STAKE_AMOUNT=50000 npm run stake

# Unstake (burn NFT, receive BCH + yield)
OWNER_WIF=<wif> NFT_TXID=<txid> NFT_VOUT=1 npm run unstake
```

## Project Structure

```
DiamondBCH/
├── contracts/
│   └── LiquidStake.cash    # Liquid staking contract (CashScript)
├── src/
│   ├── deploy.ts           # Deploy contract to chipnet
│   ├── stake.ts           # Stake BCH → get lstBCH NFT
│   ├── unstake.ts         # Unstake → burn NFT, get BCH
│   └── test-mocknet.ts    # Mock testing (Anvil equivalent)
├── tests/
│   └── LiquidStake.test.ts # Vitest tests (Foundry-style)
├── vitest.config.ts        # Test configuration
├── package.json
└── tsconfig.json
```

## Commands (Foundry-style)

| Foundry | CashScript Equivalent |
|---------|---------------------|
| `forge test` | `npm test` |
| `forge build` | `npm run compile` |
| `anvil` | MockNetworkProvider (in test) |
| `cast deploy` | `npm run deploy` |

## How It Works

### Staking Flow
1. User deposits BCH into the LiquidStake contract
2. Contract mints an lstBCH receipt NFT (commitment = staked amount)
3. User holds the NFT to earn yield

### Unstaking Flow
1. User returns the lstBCH NFT to the contract
2. Contract burns the NFT
3. User receives their original BCH + accumulated yield

## Getting Chipnet Funds

1. Install [Electron Cash](https://electroncash.org/) (CashTokens edition)
2. Switch to chipnet: Tools → Network → Chipnet
3. Get coins: https://faucet.chipnet.cash
4. Export WIF: Tools → Private Keys → Export

## Technical Details

- **Contract**: [`LiquidStake.cash`](contracts/LiquidStake.cash)
- **Language**: CashScript v0.12
- **Token Standard**: CashTokens (NFTs)
- **Network**: Bitcoin Cash Chipnet

## DeFiHub Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| MVP | LiquidStakingFacet | ✅ Ready |
| Week 1 | YieldSplitFacet (Pendle) | ⬜ Planned |
| Week 2 | DEXFacet (Concentrated AMM) | ⬜ Planned |
| Month 1 | Full 6-Facet Diamond | ⬜ Planned |

## Documentation

See [`DeFiHub-Technical-Spec.md`](DeFiHub-Technical-Spec.md) for the full technical specification.
