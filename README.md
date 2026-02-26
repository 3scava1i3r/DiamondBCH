# 💎 DiamondBCH — DeFiHub for Bitcoin Cash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network: Chipnet](https://img.shields.io/badge/Network-Chipnet-blue)](https://faucet.chipnet.cash)
[![CashScript](https://img.shields.io/badge/CashScript-0.12.0-orange)](https://cashscript.org)

**Diamond-powered DeFi hub bringing liquid staking + Pendle yield markets to Bitcoin Cash.**

> One Hub Address = Unlimited Facets. Modular DeFi via CashTokens covenants.

---

## 🎯 Why DiamondBCH?

Bitcoin Cash has the speed, low fees, and CashTokens — but lacks the DeFi primitives that make Ethereum powerful. DiamondBCH fills this gap with a **Diamond Pattern** architecture that's:

| Feature | EVM (Ethereum) | DiamondBCH (BCH) |
|---------|---------------|------------------|
| **Upgrades** | Proxy contracts, gas-heavy | Gasless token migration |
| **Composability** | Multi-contract calls | Atomic single-TX |
| **Throughput** | ~15 TPS | ~25,000 TPS potential |
| **State** | Storage slots | UTXO + CashTokens |
| **Cost** | $5-50 per TX | <$0.01 per TX |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    💎 DeFiHub (Hub Contract)                 │
│                                                              │
│   1 Hub Address = Unlimited Facets via CashToken NFTs       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Facet Registry (NFT)                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐     │   │
│  │  │ LiquidStake │ │  YieldSplit │ │    DEX      │ ... │   │
│  │  │   (lstBCH)  │ │  (Pendle)   │ │    (AMM)    │     │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘     │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│              ┌─────────────┼─────────────┐                  │
│              ▼             ▼             ▼                  │
│     ┌────────────┐  ┌───────────┐  ┌───────────┐            │
│     │  Covenant  │  │  Covenant │  │  Covenant │  ...       │
│     │  Chain 1   │  │  Chain 2  │  │  Chain 3  │            │
│     └────────────┘  └───────────┘  └───────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Hub Contract** — Single address coordinating all facets
2. **Facet NFTs** — Each DeFi primitive is a facet (minting NFT = admin)
3. **Covenants** — Self-enforcing rules via CashScript
4. **Atomic TXs** — All operations settle in one transaction

---

## ⚡ Features

### 🔄 Liquid Staking (MVP)

Stake BCH → receive **lstBCH NFT** → earn yield → unstake anytime.

```bash
# Stake 0.5 BCH
npm run stake 50000

# Receive lstBCH NFT (commitment = staked amount)
# NFT accrues yield automatically

# Unstake (burn NFT, get BCH + yield)
npm run unstake <nft-txid> 1
```

**Benefits:**
- ✅ No lock-up period
- ✅ NFT receipt = proof of stake
- ✅ Yield accrues to pool
- ✅ Minimum stake: 10,000 sats (~$1)

---

### 📊 Yield Splitting (Pendle-style)

Split lstBCH into **PT (Principal Token)** + **YT (Yield Token)**.

| Token | What It Does |
|-------|--------------|
| **PT** | Principal — redeem at expiry for face value, trades at discount |
| **YT** | Yield — accrues yield over time, sellable on DEX |

**Use Cases:**
- 🎯 **Fixed Income** — Buy PT at discount, hold to expiry
- 📈 **Yield Trading** — Buy YT to speculate on future yield
- ⚖️ **Hedging** — Split to manage interest rate exposure

---

### 🔮 Roadmap

| Phase | Facet | Status | Description |
|-------|-------|--------|-------------|
| MVP | `LiquidStakeFacet` | ✅ Live | Stake BCH → lstBCH |
| Phase 2 | `YieldSplitFacet` | ✅ Built | PT/YT splitting |
| Phase 3 | `DEXFacet` | 📋 Planned | Concentrated AMM |
| Phase 4 | `PerpsFacet` | 📋 Planned | AnyHedge-powered perps |
| Phase 5 | `OptionsFacet` | 📋 Planned | Oracle-settled options |
| Phase 6 | `GovernanceFacet` | 📋 Planned | Protocol upgrades |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- [Electron Cash](https://electroncash.org/) (CashTokens edition)

### Setup (2 min)

```bash
# Clone the repo
git clone https://github.com/3scava1i3r/DiamondBCH.git
cd DiamondBCH

# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests (100% local, like Foundry)
npm test
```

### Deploy to Chipnet

```bash
# Get chipnet funds: https://faucet.chipnet.cash

# Export your WIF from Electron Cash
export OWNER_WIF=<your-chipnet-wif>

# Deploy
npm run deploy

# Stake BCH
STAKE_AMOUNT=50000 npm run stake

# Unstake
NFT_TXID=<txid> NFT_VOUT=1 npm run unstake
```

---

## 💰 Tokenomics

### Fee Structure

| Action | Fee | Destination |
|--------|-----|-------------|
| Stake | 0.1% | YieldPool |
| Unstake | 0.1% | YieldPool |
| Split/Merge | 0.02% | Treasury |
| DEX Swap | 0.03% | LP + Treasury |

### Yield Distribution

```
Total Yield from Staked BCH
         │
    ┌────┴────┐
    ▼         ▼
  90%       10%
    │         │
    ▼         ▼
lstBCH    Treasury
Holders   (Protocol)
```

### Projected Returns

| TVL | Monthly Revenue | APY |
|-----|-----------------|-----|
| $1M | $1,000 | 6-8% |
| $5M | $5,000 | 8-10% |
| $10M | $10,000 | 10-12% |

---

## 🛠 Tech Stack

| Component | Technology |
|-----------|------------|
| **Smart Contracts** | [CashScript](https://cashscript.org/) v0.12 |
| **Token Standard** | [CashTokens](https://chip2022.cash/) (CHIP-2022-05) |
| **Testing** | [Vitest](https://vitest.dev/) + MockNetworkProvider |
| **Deployment** | tsx + TypeScript |
| **Wallet** | [Badger Wallet](https://badgerwallet.cash/) / Electron Cash |
| **Frontend** | React + Vite (planned) |

### Foundry-Equivalent Workflow

| Foundry | DiamondBCH |
|---------|------------|
| `forge build` | `npm run compile` |
| `forge test` | `npm test` |
| `anvil` | `MockNetworkProvider` |
| `cast send` | `npm run stake` |

---

## 📁 Project Structure

```
DiamondBCH/
├── contracts/
│   ├── LiquidStake.cash      # Liquid staking contract
│   └── YieldSplitFacet.cash  # PT/YT splitting
├── src/
│   ├── deploy.ts             # Deploy to chipnet
│   ├── stake.ts              # Stake BCH
│   ├── unstake.ts            # Unstake + claim yield
│   └── yield-split.ts        # Split/merge PT/YT
├── tests/
│   ├── LiquidStake.test.ts   # Stake/unstake tests
│   └── YieldSplitFacet.test.ts # PT/YT tests
├── LiquidStake.json          # Compiled artifact
└── DeFiHub-Technical-Spec.md # Full specification
```

---

## 🤝 Contributing

We're building the future of DeFi on Bitcoin Cash. Join us!

### Ways to Contribute

- 🐛 **Report bugs** — Open an issue
- 💡 **Propose features** — Start a discussion
- 🔨 **Submit PRs** — Fork, branch, PR
- 📢 **Spread the word** — Tell the BCH community

### Development Setup

```bash
npm install
npm run compile
npm test

# Make changes, add tests, submit PR
```

---

## 🔗 Links

- 📖 [Technical Specification](./DeFiHub-Technical-Spec.md)
- 🌐 [CashScript Docs](https://cashscript.org/docs/)
- 💰 [Chipnet Faucet](https://faucet.chipnet.cash)
- 📝 [CashTokens CHIP](https://chip2022.cash/)

---

## 📄 License

MIT License — Build freely on Bitcoin Cash.

---

<div align="center">

**💎 DiamondBCH — DeFi, Diamond-Cut for Bitcoin Cash**

*Stake. Split. Swap. All on BCH.*

[Get Started](#-quick-start) · [Read the Spec](./DeFiHub-Technical-Spec.md) · [Contribute](#-contributing)

</div>