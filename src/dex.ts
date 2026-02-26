import { Contract, ElectrumNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { createHash } from 'crypto';
import bs58check from 'bs58check';

/**
 * DEXFacet - Concentrated Liquidity AMM (Uniswap V3-style)
 *
 * Prerequisites:
 *   - Contract deployed (via deploy.ts)
 *   - Position minting NFT created
 *
 * Usage:
 *   Add Liquidity:
 *     OWNER_WIF=<wif> AMOUNT0=100000 AMOUNT1=100000 TICK_LOWER=0 TICK_UPPER=100 npx tsx src/dex.ts --action add
 *
 *   Remove Liquidity:
 *     OWNER_WIF=<wif> POSITION_TXID=<txid> POSITION_VOUT=<vout> AMOUNT0=100000 AMOUNT1=100000 npx tsx src/dex.ts --action remove
 *
 *   Swap:
 *     OWNER_WIF=<wif> ZERO_FOR_ONE=true AMOUNT_IN=10000 MIN_AMOUNT_OUT=9900 npx tsx src/dex.ts --action swap
 *
 *   Collect Fees:
 *     OWNER_WIF=<wif> POSITION_TXID=<txid> POSITION_VOUT=<vout> FEE_AMOUNT0=100 FEE_AMOUNT1=50 npx tsx src/dex.ts --action collect
 */

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Helper: Encode PKH to Cash Address
function pkhToCashAddress(pkh: Uint8Array, network: 'bchtest' | 'bchreg' = 'bchtest'): string {
  const version = 0x00;
  const payload = Buffer.concat([Buffer.from([version]), Buffer.from(pkh)]);
  const address = bs58check.encode(payload);
  return `${network}:${address}`;
}

// Helper: Build position NFT commitment (tickLower + tickUpper + liquidity)
function buildPositionCommitment(tickLower: number, tickUpper: number, liquidity: bigint): string {
  const tickLowerBytes = Buffer.alloc(4);
  tickLowerBytes.writeUInt32BE(tickLower);
  const tickUpperBytes = Buffer.alloc(4);
  tickUpperBytes.writeUInt32BE(tickUpper);
  const liquidityBytes = Buffer.alloc(8);
  liquidityBytes.writeBigUInt64BE(liquidity);
  return tickLowerBytes.toString('hex') + tickUpperBytes.toString('hex') + liquidityBytes.toString('hex');
}

// Helper: Parse position NFT commitment
function parsePositionCommitment(commitment: string): { tickLower: number; tickUpper: number; liquidity: bigint } {
  const tickLower = parseInt(commitment.slice(0, 8), 16); // 4 bytes
  const tickUpper = parseInt(commitment.slice(8, 16), 16); // 4 bytes
  const liquidity = BigInt('0x' + commitment.slice(16, 32)); // 8 bytes
  return { tickLower, tickUpper, liquidity };
}

// Helper: Calculate liquidity from amounts (simplified)
function calculateLiquidity(amount0: bigint, amount1: bigint): bigint {
  // Simplified: use geometric mean
  // In production, use proper concentrated liquidity formula
  if (amount0 < amount1) {
    return amount0;
  }
  return amount1;
}

// Helper: Calculate swap output (simplified)
function calculateSwapOutput(amountIn: bigint, zeroForOne: boolean, fee: number = 30): bigint {
  // 0.3% fee (30 basis points)
  const feeAmount = amountIn * BigInt(fee) / BigInt(10000);
  const amountAfterFee = amountIn - feeAmount;
  return amountAfterFee;
}

async function main() {
  const action = process.env.ACTION || process.argv[2]?.replace('--action=', '') || 'add';
  const ownerWif = process.env.OWNER_WIF;

  if (!ownerWif) {
    console.error('❌ Set OWNER_WIF env var');
    console.error('\nUsage:');
    console.error('  Add Liquidity:  OWNER_WIF=<wif> AMOUNT0=100000 AMOUNT1=100000 TICK_LOWER=0 TICK_UPPER=100 npx tsx src/dex.ts --action add');
    console.error('  Remove Liquidity: OWNER_WIF=<wif> POSITION_TXID=<txid> POSITION_VOUT=<vout> npx tsx src/dex.ts --action remove');
    console.error('  Swap: OWNER_WIF=<wif> ZERO_FOR_ONE=true AMOUNT_IN=10000 MIN_AMOUNT_OUT=9900 npx tsx src/dex.ts --action swap');
    console.error('  Collect Fees: OWNER_WIF=<wif> POSITION_TXID=<txid> POSITION_VOUT=<vout> npx tsx src/dex.ts --action collect');
    process.exit(1);
  }

  console.log(`⚡ DEXFacet - Action: ${action}`);
  console.log('='.repeat(50));

  const provider = new ElectrumNetworkProvider('chipnet');
  const sigTemplate = new SignatureTemplate(ownerWif);

  // Derive owner PKH and address
  const pubkey = sigTemplate.getPublicKey();
  const ownerPkh = hash160(pubkey);
  const ownerAddress = pkhToCashAddress(ownerPkh, 'bchtest');

  console.log('👤 Owner address:', ownerAddress);

  // Compile & instantiate DEXFacet
  const artifact = compileFile(new URL('../contracts/DEXFacet.cash', import.meta.url));

  // Use hub PKH
  const hubPkh = ownerPkh;
  const contract = new Contract(artifact, [hubPkh], { provider });

  console.log('📍 Contract address:', contract.address);

  try {
    switch (action) {
      case 'add': {
        const amount0 = BigInt(process.env.AMOUNT0 || '100000');
        const amount1 = BigInt(process.env.AMOUNT1 || '100000');
        const tickLower = parseInt(process.env.TICK_LOWER || '0', 10);
        const tickUpper = parseInt(process.env.TICK_UPPER || '100', 10);

        console.log(`\n📥 Adding Liquidity:`);
        console.log(`   Token0: ${amount0}`);
        console.log(`   Token1: ${amount1}`);
        console.log(`   Tick Range: [${tickLower}, ${tickUpper})`);

        // Calculate liquidity
        const liquidity = calculateLiquidity(amount0, amount1);
        console.log(`   Liquidity: ${liquidity}`);

        // Build position commitment
        const commitment = buildPositionCommitment(tickLower, tickUpper, liquidity);
        console.log(`   Commitment: ${commitment}`);

        // Call addLiquidity - use @ts-ignore for cashscript types
        // @ts-ignore - CashScript contract method
        const tx = await contract.functions.addLiquidity(
          amount0,
          amount1,
          tickLower,
          tickUpper
        )
          .to([
            { address: contract.address, value: 1000 }, // Contract UTXO (covenant)
            { address: ownerAddress, tokenCategory: 'position', nftCommitment: commitment }, // Position NFT
          ], { sender: ownerAddress })
          .send();

        console.log(`\n✅ Liquidity added!`);
        console.log(`   TXID: ${tx.txid}`);
        break;
      }

      case 'remove': {
        const positionTxid = process.env.POSITION_TXID;
        const positionVout = parseInt(process.env.POSITION_VOUT || '0', 10);
        const amount0 = BigInt(process.env.AMOUNT0 || '100000');
        const amount1 = BigInt(process.env.AMOUNT1 || '100000');

        if (!positionTxid) {
          console.error('❌ Set POSITION_TXID env var');
          process.exit(1);
        }

        console.log(`\n📤 Removing Liquidity:`);
        console.log(`   Position: ${positionTxid}:${positionVout}`);
        console.log(`   Amount0: ${amount0}`);
        console.log(`   Amount1: ${amount1}`);

        // Get position from user's address
        const userUtxos = await provider.getUtxos(ownerAddress);
        const positionUtxo = userUtxos.find(u =>
          u.token?.nft?.capability === 'none' &&
          u.token?.nft?.commitment?.length === 32
        );

        if (!positionUtxo) {
          console.error('❌ No position NFT found');
          process.exit(1);
        }

        // Call removeLiquidity - use @ts-ignore
        // @ts-ignore - CashScript contract method
        const tx = await contract.functions.removeLiquidity(amount0, amount1)
          .from(positionUtxo)
          .to([
            { address: contract.address, value: 1000 }, // Contract UTXO
            { address: ownerAddress, tokenCategory: 'token0', amount: amount0 }, // Token0 to LP
            { address: ownerAddress, tokenCategory: 'token1', amount: amount1 }, // Token1 to LP
          ], { sender: ownerAddress })
          .send();

        console.log(`\n✅ Liquidity removed!`);
        console.log(`   TXID: ${tx.txid}`);
        break;
      }

      case 'swap': {
        const zeroForOne = (process.env.ZERO_FOR_ONE || 'true').toLowerCase() === 'true';
        const amountIn = BigInt(process.env.AMOUNT_IN || '10000');
        const minAmountOut = BigInt(process.env.MIN_AMOUNT_OUT || '9900');

        console.log(`\n🔄 Swapping:`);
        console.log(`   Direction: ${zeroForOne ? 'Token0 → Token1' : 'Token1 → Token0'}`);
        console.log(`   Amount In: ${amountIn}`);
        console.log(`   Min Amount Out: ${minAmountOut}`);

        // Calculate expected output
        const expectedOut = calculateSwapOutput(amountIn, zeroForOne);
        console.log(`   Expected Out: ${expectedOut}`);

        // Call swap - use @ts-ignore
        // @ts-ignore - CashScript contract method
        const tx = await contract.functions.swap(zeroForOne, amountIn, minAmountOut)
          .to([
            { address: contract.address, value: 1000 }, // Contract UTXO
            { address: ownerAddress, tokenCategory: zeroForOne ? 'token1' : 'token0', amount: expectedOut }, // Output
          ], { sender: ownerAddress })
          .send();

        console.log(`\n✅ Swap complete!`);
        console.log(`   TXID: ${tx.txid}`);
        break;
      }

      case 'collect': {
        const positionTxid = process.env.POSITION_TXID;
        const positionVout = parseInt(process.env.POSITION_VOUT || '0', 10);
        const feeAmount0 = BigInt(process.env.FEE_AMOUNT0 || '100');
        const feeAmount1 = BigInt(process.env.FEE_AMOUNT1 || '50');

        if (!positionTxid) {
          console.error('❌ Set POSITION_TXID env var');
          process.exit(1);
        }

        console.log(`\n💰 Collecting Fees:`);
        console.log(`   Position: ${positionTxid}:${positionVout}`);
        console.log(`   Fee Token0: ${feeAmount0}`);
        console.log(`   Fee Token1: ${feeAmount1}`);

        // Get position UTXO
        const userUtxos = await provider.getUtxos(ownerAddress);
        const positionUtxo = userUtxos.find(u =>
          u.token?.nft?.capability === 'none' &&
          u.token?.nft?.commitment?.length === 32
        );

        if (!positionUtxo) {
          console.error('❌ No position NFT found');
          process.exit(1);
        }

        const positionCommitment = positionUtxo.token?.nft?.commitment || '';

        // Call collect - use @ts-ignore
        // @ts-ignore - CashScript contract method
        const tx = await contract.functions.collect(feeAmount0, feeAmount1)
          .from(positionUtxo)
          .to([
            { address: contract.address, value: 1000 }, // Contract UTXO
            { address: ownerAddress, tokenCategory: 'position', nftCommitment: positionCommitment }, // Updated position
            { address: ownerAddress, tokenCategory: 'token0', amount: feeAmount0 }, // Fee token0
            { address: ownerAddress, tokenCategory: 'token1', amount: feeAmount1 }, // Fee token1
          ], { sender: ownerAddress })
          .send();

        console.log(`\n✅ Fees collected!`);
        console.log(`   TXID: ${tx.txid}`);
        break;
      }

      default:
        console.error(`❌ Unknown action: ${action}`);
        console.error('\nAvailable actions: add, remove, swap, collect');
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message || error);
    if (error.message?.includes('UTXO') || error.message?.includes('utxo')) {
      console.error('\n💡 Tips:');
      console.error('   - Make sure the NFT UTXO still exists and is unspent');
      console.error('   - Check that you have the correct transaction ID and vout');
    }
    process.exit(1);
  }
}

main().catch(console.error);
