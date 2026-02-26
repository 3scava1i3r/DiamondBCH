# BCH DeFiHub - Technical Specification

## Overview

**DeFiHub** is a modular Diamond Protocol on Bitcoin Cash that brings EVM-missing DeFi instruments to BCH using CashTokens and covenants. 

> One protocol address coordinating EVM-missing instruments via facet covenants + CashTokens.

## Architecture

### Diamond Pattern for BCH

Unlike EVM's Diamond Standard (EIP-2535), BCH uses a covenant-based approach:

```
┌─────────────────────────────────────────────────────────────┐
│                     DeFiHub (Hub Contract)                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Facet Registry (CashToken NFT)                      │    │
│  │ - LiquidStakingFacet (lstBCH)                       │    │
│  │ - YieldSplitFacet (YT/PT)                           │    │
│  │ - DEXFacet (AMM)                                    │    │
│  │ - OrderFacet (Perps)                                │    │
│  │ - OptionsFacet                                      │    │
│  │ - GovernanceFacet                                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                  │
│              ┌─────────────┼─────────────┐                   │
│              ▼             ▼             ▼                   │
│     ┌────────────┐  ┌───────────┐  ┌───────────┐             │
│     │  Facet 1   │  │  Facet 2  │  │  Facet 3  │  ...        │
│     │ (Stake)    │  │ (Split)   │  │  (AMM)    │             │
│     └────────────┘  └───────────┘  └───────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Type | Purpose |
|-----------|------|---------|
| Hub Contract | Covenant | Facet registry, governance, upgradeability |
| Facet | CashScript Contract | Independent DeFi functionality |
| CashToken NFT | FT/NFT | State representation (lstBCH, YT, PT, LP) |
| Covenant Chain | TX Sequence | Cross-facet communication |

---

## Facet Specifications

### 1. LiquidStakingFacet (MVP)

**Purpose**: Stake BCH → receive lstBCH NFT receipt → earn yield

**CashToken Usage**:
- Minting NFT: Category for lstBCH receipts
- Receipt NFT: Commitment = staked sats amount

**Contract Functions**:

```cashscript
contract LiquidStakeFacet(bytes20 ownerPkh) {
    // Stake BCH → mint receipt NFT
    function stake() 
    
    // Unstake → burn receipt NFT + payout
    function unstake()
    
    // Owner management
    function withdraw(pubkey pk, sig s)
}
```

**Flow**:
```
User → Deposit BCH → Contract UTXO (minting NFT)
                   → Mint receipt NFT (commitment = amount)
                   → User receives lstBCH NFT

User → Return lstBCH NFT → Burn NFT
                         → Receive BCH + yield
```

---

### 2. YieldSplitFacet (Pendle-like)

**Purpose**: Split lstBCH into YT (Yield Token) + PT (Principal Token)

**CashToken Usage**:
- lstBCH Input: NFT receipt from LiquidStakingFacet
- PT NFT: Principal token (can be held to redeem face value)
- YT NFT: Yield token (accrues yield, sellable)

**Contract Design**:

```cashscript
contract YieldSplitFacet(bytes20 hubPkh) {
    // Split: lstBCH → PT + YT
    // Input 0: lstBCH NFT
    // Output 0: PT NFT (commitment = expiry, principal)
    // Output 1: YT NFT (commitment = expiry, yield)
    function split()
    
    // Merge: PT + YT → lstBCH
    function merge()
    
    // Redeem PT at expiry → get principal
    function redeemPT()
    
    // Claim YT yield → based on time passed
    function claimYield()
}
```

**Token Economics**:
- PT: Trades at discount to face value (time value)
- YT: Price = expected yield, trades on DEXFacet

---

### 3. DEXFacet (Concentrated AMM)

**Purpose**: Uniswap V3-style concentrated liquidity with tick NFTs

**CashToken Usage**:
- LP NFT: Commitment = tick range (minTick, maxTick)
- Position NFT: Tracks liquidity position

**Contract Design**:

```cashscript
contract DEXFacet(bytes20 hubPkh, bytes32 tokenPair) {
    // Add liquidity → mint position NFT
    function addLiquidity(int amount0, int amount1, int tickLower, int tickUpper)
    
    // Remove liquidity → burn position NFT + return tokens
    function removeLiquidity(bytes positionNftCommitment)
    
    // Swap: token0 → token1 or token1 → token0
    function swap(bool zeroForOne, int amountIn, int minAmountOut)
    
    // Collect fees from position
    function collect(bytes positionNftCommitment)
}
```

**Tick NFT Structure**:
```
Commitment: bytes(tickLower:u4) + bytes(tickUpper:u4) + bytes(liquidity:u8)
```

**Key Features**:
- Concentrated liquidity (range orders)
- Tick-based pricing
- Fee collection on swaps
- NFT-based positions

---

### 4. OrderFacet + AnyHedgeFacet (Perps/Leverage)

**Purpose**: Perpetual swaps leveraging AnyHedge for hedging

**Architecture**:

```cashscript
// OrderFacet: Matched order book for perps
contract OrderFacet(bytes20 hubPkh) {
    // Place order: long/short
    function placeOrder(int size, int price, bool isLong)
    
    // Match orders (via sequenced threads)
    function matchOrders(bytes orderId1, bytes orderId2)
    
    // Liquidate undercollateralized positions
    function liquidate(bytes positionId)
}

// AnyHedgeFacet: Hedge settlement via AnyHedge
contract AnyHedgeFacet(bytes20 hubPkh) {
    // Open hedge position
    function openHedge(int notional, int duration)
    
    // Settle hedge at expiry
    function settle(bytes hedgeId)
    
    // Payout to long/short based on price
    function resolve(bytes hedgeId, int finalPrice)
}
```

**Integration Flow**:
1. User opens perp position (long/short)
2. OrderFacet matches with counterparty or AMM
3. AnyHedgeFacet creates hedge contract
4. Price oracle updates position value
5. At expiry: hedge settles, PnL distributed

---

### 5. OptionsFacet (Oracle Pricing)

**Purpose**: Options pricing with Oracle + Exercise settlement

**Contract Design**:

```cashscript
// OracleFacet: Price feeds for options
contract OracleFacet(bytes20 hubPkh, bytes20 adminPkh) {
    // Update price (admin only)
    function updatePrice(bytes32 asset, int price)
    
    // Read current price
    function getPrice(bytes32 asset) returns int
    
    // Time-weighted average price
    function getTWAP(bytes32 asset, int window) returns int
}

// ExerciseFacet: Option exercise logic
contract ExerciseFacet(bytes20 hubPkh) {
    // Write option: mint call/put NFT
    function writeOption(bytes32 asset, int strike, int expiry, bool isCall)
    
    // Exercise: if ITM, receive payout
    function exercise(bytes optionNftCommitment)
    
    // Expire: burn OTMs, return collateral to writers
    function expire(bytes optionNftCommitment)
}
```

**Option NFT Commitment**:
```
bytes32(asset) + bytes4(strike) + bytes4(expiry) + bytes1(isCall ? 0x01 : 0x00)
```

**Pricing Model**:
- Use OracleFacet for underlying price
- Black-Scholes adapted for CashScript
- Greeks calculated off-chain, verified on-chain

---

### 6. GovernanceFacet (Upgrade Hub)

**Purpose**: Upgrade facets, manage protocol parameters

**Contract Design**:

```cashscript
contract GovernanceFacet(bytes20 adminPkh) {
    // Add new facet to hub
    function addFacet(bytes32 facetId, bytes32 facetCodehash)
    
    // Remove/upgrade facet
    function removeFacet(bytes32 facetId)
    
    // Update protocol parameters
    function setParameter(bytes32 param, int value)
    
    // Emergency pause
    function pause()
    
    // Resume after pause
    function resume()
}
```

**Facet Registry (CashToken NFT)**:
```
Category: Hub's minting NFT
Commitment: facetId + codehash + version
```

---

## Cross-Facet Communication

### Covenant Chains

Facets communicate via **covenant chains** - sequential transactions where output of one facet becomes input to another:

```
TX1: LiquidStakeFacet (stake) 
     → Output: lstBCH NFT

TX2: YieldSplitFacet (split)
     → Input: lstBCH NFT
     → Output: PT NFT + YT NFT

TX3: DEXFacet (sell YT)
     → Input: YT NFT  
     → Output: BCH (from swap)
```

### State Synchronization

Use **CashToken commitments** as shared state:
- NFT commitments encode position data
- FT amounts represent token balances
- Transaction binding ensures atomicity

---

## Deployment Strategy

### Phase-Gated Delivery

| Phase | Facet | Timeline |
|-------|-------|----------|
| MVP | LiquidStakingFacet | Today |
| Week 1 | YieldSplitFacet | Pendle V1 |
| Week 2 | DEXFacet | Concentrated AMM |
| Month 1 | Full 6-Facet Diamond | All facets |

### Network Targets

1. **Chipnet** - Development & testing
2. **BCHN (mainnet)** - Production deployment

---

## Technical Constraints

### BCH Limitations
- No EVM → CashScript only
- No persistent storage → Use UTXO model
- No external calls → Covenant enforcement

### Solutions
- CashTokens for state
- Multi-Sig for admin functions
- Sequenced threads for complex flows

---

## Revenue Model

| Facet | Fee | Projected MRR |
|-------|-----|---------------|
| LiquidStaking | 0.05% | $5k @ $10M TVL |
| YieldSplit | 0.02% | $2k @ $10M TVL |
| DEX | 0.03% | $3k @ $10M TVL |
| Perps | 0.01% | $1k @ $10M TVL |

---

## Implementation TODO

### Phase 1: LiquidStaking MVP
- [x] LiquidStake.cash contract
- [x] deploy.ts script
- [ ] stake.ts - complete transaction builder
- [ ] unstake.ts - new file
- [ ] Test on chipnet

### Phase 2: YieldSplitFacet
- [x] YieldSplitFacet.cash contract
- [x] yield-split.ts helper script
- [x] PT/YT NFT logic
- [x] Tests for split/merge/redeem/claim

### Phase 3: DEXFacet
- [ ] DEXFacet.cash contract
- [ ] Tick-based pricing
- [ ] LP NFT positions

### Phase 4: OrderFacet + AnyHedgeFacet
- [ ] OrderFacet.cash
- [ ] AnyHedgeFacet.cash
- [ ] Oracle integration

### Phase 5: OptionsFacet
- [ ] OracleFacet.cash
- [ ] ExerciseFacet.cash

### Phase 6: GovernanceFacet
- [ ] GovernanceFacet.cash
- [ ] Facet registry

---

*Generated: 2026-02-25*
*Status: Architectural Planning*
