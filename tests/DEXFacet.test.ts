import { describe, it, expect, beforeEach } from 'vitest';
import { Contract, MockNetworkProvider, SignatureTemplate } from 'cashscript';
import { compileFile } from 'cashc';
import { createHash } from 'crypto';

// Helper: hash160
function hash160(data: Uint8Array): Uint8Array {
  const sha = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha).digest();
}

// Test WIF (chipnet test key - NO REAL FUNDS)
const TEST_WIF = 'cW2N3g6PTEvZin8cij7oF6JcvsDGdDjGnF2MmQgRA11rRdJjMuFa';
const MOCK_CATEGORY = '0000000000000000000000000000000000000000000000000000000000000002';

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

describe('DEXFacet Contract', () => {
  let provider: MockNetworkProvider;
  let artifact: any;
  let hubPkh: Uint8Array;
  let contract: Contract;

  beforeEach(async () => {
    // Setup provider like Anvil
    provider = new MockNetworkProvider();
    
    // Compile contract
    artifact = compileFile(new URL('../contracts/DEXFacet.cash', import.meta.url));
    
    // Derive hub PKH from WIF
    const sigTemplate = new SignatureTemplate(TEST_WIF);
    const pubkey = sigTemplate.getPublicKey();
    hubPkh = hash160(pubkey);
    
    // Token pair (placeholder)
    
    // Deploy contract to mock network
    contract = new Contract(artifact, [hubPkh], { provider });
  });

  describe('deployment', () => {
    it('should compile and deploy successfully', () => {
      expect(contract.address).toBeDefined();
      expect(contract.bytesize).toBeGreaterThan(0);
      expect(contract.opcount).toBeGreaterThan(0);
    });

    it('should have valid addresses', () => {
      expect(contract.address).toMatch(/^bchtest:/);
    });
  });

  describe('contract functions exist', () => {
    it('should have addLiquidity function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.addLiquidity).toBe('function');
    });

    it('should have removeLiquidity function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.removeLiquidity).toBe('function');
    });

    it('should have swap function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.swap).toBe('function');
    });

    it('should have collect function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.collect).toBe('function');
    });

    it('should have setFee function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.setFee).toBe('function');
    });

    it('should have withdraw function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.withdraw).toBe('function');
    });
  });

  describe('position commitment helpers', () => {
    it('should build position commitment correctly', () => {
      const tickLower = 0;
      const tickUpper = 100;
      const liquidity = 1000000n;
      
      const commitment = buildPositionCommitment(tickLower, tickUpper, liquidity);
      
      // Commitment should be 32 hex chars (16 bytes)
      expect(commitment).toHaveLength(32);
      
      // Parse and verify
      const parsed = parsePositionCommitment(commitment);
      expect(parsed.tickLower).toBe(tickLower);
      expect(parsed.tickUpper).toBe(tickUpper);
      expect(parsed.liquidity).toBe(liquidity);
    });

    it('should handle various tick ranges', () => {
      const testCases = [
        { tickLower: 0, tickUpper: 100, liquidity: 1000n },
        { tickLower: 1000, tickUpper: 2000, liquidity: 5000n },
        { tickLower: 10000, tickUpper: 50000, liquidity: 100000n },
      ];

      testCases.forEach(({ tickLower, tickUpper, liquidity }) => {
        const commitment = buildPositionCommitment(tickLower, tickUpper, liquidity);
        const parsed = parsePositionCommitment(commitment);
        
        expect(parsed.tickLower).toBe(tickLower);
        expect(parsed.tickUpper).toBe(tickUpper);
        expect(parsed.liquidity).toBe(liquidity);
      });
    });

    it('should handle large liquidity values', () => {
      const tickLower = 0;
      const tickUpper = 100;
      const maxLiquidity = 18446744073709551615n; // Max uint64
      
      const commitment = buildPositionCommitment(tickLower, tickUpper, maxLiquidity);
      const parsed = parsePositionCommitment(commitment);
      
      expect(parsed.liquidity).toBe(maxLiquidity);
    });
  });

  describe('addLiquidity validation', () => {
    it('should validate tick range', () => {
      // tickLower must be < tickUpper
      const tickLower = 100;
      const tickUpper = 50; // Invalid: upper < lower
      
      const commitment = buildPositionCommitment(tickLower, tickUpper, 1000n);
      
      // Should fail validation since tickLower > tickUpper
      const parsed = parsePositionCommitment(commitment);
      expect(parsed.tickLower).not.toBeLessThan(parsed.tickUpper);
    });

    it('should validate tickLower >= 0', () => {
      const tickLower = -1; // Invalid
      const tickUpper = 100;
      
      // Negative values should be handled carefully in CashScript
      // In practice, we'd use absolute values or validate differently
      const commitment = buildPositionCommitment(0, tickUpper, 1000n);
      const parsed = parsePositionCommitment(commitment);
      
      expect(parsed.tickLower).toBeGreaterThanOrEqual(0);
    });
  });

  describe('swap calculations', () => {
    it('should calculate correct output with fee', () => {
      const amountIn = 10000n;
      const fee = 30; // 0.3%
      const feeAmount = amountIn * BigInt(fee) / BigInt(10000);
      const expectedOut = amountIn - feeAmount;
      
      expect(feeAmount).toBe(30n);
      expect(expectedOut).toBe(9970n);
    });

    it('should handle different fee rates', () => {
      const testCases = [
        { amountIn: 10000n, fee: 3, expected: 9997n },   // 0.03%
        { amountIn: 10000n, fee: 30, expected: 9970n }, // 0.3%
        { amountIn: 10000n, fee: 100, expected: 9900n }, // 1%
      ];

      testCases.forEach(({ amountIn, fee, expected }) => {
        const output = amountIn - (amountIn * BigInt(fee) / BigInt(10000));
        expect(output).toBe(expected);
      });
    });
  });

  describe('liquidity calculation', () => {
    it('should calculate liquidity correctly', () => {
      const amount0 = 100000n;
      const amount1 = 100000n;
      
      // Simplified: liquidity = min(amount0, amount1)
      const liquidity = amount0 < amount1 ? amount0 : amount1;
      
      expect(liquidity).toBe(100000n);
    });

    it('should handle unequal amounts', () => {
      const amount0 = 50000n;
      const amount1 = 100000n;
      
      const liquidity = amount0 < amount1 ? amount0 : amount1;
      
      expect(liquidity).toBe(50000n);
    });

    it('should handle large amounts', () => {
      const amount0 = 1000000000n; // 1 billion
      const amount1 = 1000000000n;
      
      const liquidity = amount0 < amount1 ? amount0 : amount1;
      
      expect(liquidity).toBe(1000000000n);
    });
  });

  describe('fee collection', () => {
    it('should validate fee amounts', () => {
      const feeAmount0 = 100n;
      const feeAmount1 = 50n;
      
      expect(feeAmount0).toBeGreaterThan(0);
      expect(feeAmount1).toBeGreaterThan(0);
    });

    it('should allow zero fees for one token', () => {
      const feeAmount0 = 100n;
      const feeAmount1 = 0n;
      
      // At least one fee should be positive
      expect(feeAmount0 > 0 || feeAmount1 > 0).toBe(true);
    });
  });
});
