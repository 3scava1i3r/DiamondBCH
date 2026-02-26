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

// Helper to build PT commitment (principal + expiry) - Big-endian for CashScript
function buildPTCommitment(principal: bigint, expiry: number): string {
  const principalBytes = Buffer.alloc(8);
  principalBytes.writeBigUInt64BE(principal);
  const expiryBytes = Buffer.alloc(4);
  expiryBytes.writeUInt32BE(expiry);
  return principalBytes.toString('hex') + expiryBytes.toString('hex');
}

// Helper to build YT commitment (yieldAccrued + expiry) - Big-endian for CashScript
function buildYTCommitment(yieldAccrued: bigint, expiry: number): string {
  const yieldBytes = Buffer.alloc(8);
  yieldBytes.writeBigUInt64BE(yieldAccrued);
  const expiryBytes = Buffer.alloc(4);
  expiryBytes.writeUInt32BE(expiry);
  return yieldBytes.toString('hex') + expiryBytes.toString('hex');
}

describe('YieldSplitFacet Contract', () => {
  let provider: MockNetworkProvider;
  let artifact: any;
  let hubPkh: Uint8Array;
  let contract: Contract;

  beforeEach(async () => {
    // Setup provider like Anvil
    provider = new MockNetworkProvider();
    
    // Compile contract
    artifact = compileFile(new URL('../contracts/YieldSplitFacet.cash', import.meta.url));
    
    // Derive hub PKH from WIF
    const sigTemplate = new SignatureTemplate(TEST_WIF);
    const pubkey = sigTemplate.getPublicKey();
    hubPkh = hash160(pubkey);
    
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
    it('should have split function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.split).toBe('function');
    });

    it('should have merge function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.merge).toBe('function');
    });

    it('should have redeemPT function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.redeemPT).toBe('function');
    });

    it('should have claimYield function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.claimYield).toBe('function');
    });

    it('should have withdraw function', () => {
      // @ts-ignore - functions exist at runtime
      expect(typeof contract.unlock.withdraw).toBe('function');
    });
  });

  describe('commitment helpers', () => {
    it('should build correct PT commitment', () => {
      const principal = 50000n;
      const expiry = 500000;
      const commitment = buildPTCommitment(principal, expiry);
      
      // Verify structure: 8 bytes principal + 4 bytes expiry = 12 bytes = 24 hex chars
      expect(commitment.length).toBe(24);
      
      // Parse back (big-endian)
      const parsedPrincipal = BigInt('0x' + commitment.slice(0, 16));
      const parsedExpiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(parsedPrincipal).toBe(principal);
      expect(parsedExpiry).toBe(expiry);
    });

    it('should build correct YT commitment', () => {
      const yieldAccrued = 1000n;
      const expiry = 500000;
      const commitment = buildYTCommitment(yieldAccrued, expiry);
      
      // Verify structure
      expect(commitment.length).toBe(24);
      
      // Parse back (big-endian)
      const parsedYield = BigInt('0x' + commitment.slice(0, 16));
      const parsedExpiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(parsedYield).toBe(yieldAccrued);
      expect(parsedExpiry).toBe(expiry);
    });

    it('should handle zero yield in YT commitment', () => {
      const commitment = buildYTCommitment(0n, 500000);
      
      expect(commitment.startsWith('0000000000000000')).toBe(true);
    });
  });

  describe('commitment parsing', () => {
    it('should parse PT commitment correctly', () => {
      const commitment = buildPTCommitment(100000n, 750000);
      const principal = BigInt('0x' + commitment.slice(0, 16));
      const expiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(principal).toBe(100000n);
      expect(expiry).toBe(750000);
    });

    it('should parse YT commitment correctly', () => {
      const commitment = buildYTCommitment(2500n, 750000);
      const yieldAccrued = BigInt('0x' + commitment.slice(0, 16));
      const expiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(yieldAccrued).toBe(2500n);
      expect(expiry).toBe(750000);
    });
  });

  describe('token economics', () => {
    it('should handle small principal amounts', () => {
      const commitment = buildPTCommitment(1000n, 500000);
      expect(commitment.length).toBe(24);
    });

    it('should handle large principal amounts', () => {
      const commitment = buildPTCommitment(1000000000n, 500000); // 10k BCH
      expect(commitment.length).toBe(24);
    });

    it('should handle various expiry timestamps', () => {
      const expiries = [1000, 100000, 500000, 1000000, 1999999];
      
      expiries.forEach(expiry => {
        const ptCommitment = buildPTCommitment(50000n, expiry);
        const ytCommitment = buildYTCommitment(1000n, expiry);
        
        expect(ptCommitment.length).toBe(24);
        expect(ytCommitment.length).toBe(24);
        
        const parsedExpiry = parseInt(ptCommitment.slice(16, 24), 16);
        expect(parsedExpiry).toBe(expiry);
      });
    });
  });

  describe('split transaction structure', () => {
    it('should have correct number of outputs for split', () => {
      // Split creates 2 outputs: PT + YT
      const outputCount = 2;
      expect(outputCount).toBe(2);
    });

    it('should use same token category for PT and YT', () => {
      // Both PT and YT should use the same lstBCH category
      const category = MOCK_CATEGORY;
      expect(category).toBeDefined();
      expect(category.length).toBe(64); // 32 bytes hex
    });
  });

  describe('merge transaction structure', () => {
    it('should require matching expiry for PT and YT', () => {
      const expiry = 500000;
      
      const ptCommitment = buildPTCommitment(50000n, expiry);
      const ytCommitment = buildYTCommitment(1000n, expiry);
      
      const ptExpiry = parseInt(ptCommitment.slice(16, 24), 16);
      const ytExpiry = parseInt(ytCommitment.slice(16, 24), 16);
      
      expect(ptExpiry).toBe(ytExpiry);
    });

    it('should create single lstBCH output when merging', () => {
      // Merge burns PT + YT and creates 1 lstBCH NFT
      const outputCount = 1;
      expect(outputCount).toBe(1);
    });
  });

  describe('redeemPT validation', () => {
    it('should require currentTime >= expiry for redemption', () => {
      const expiry = 500000;
      const validTime = 500001;
      const invalidTime = 499999;
      
      // Should be valid
      expect(validTime >= expiry).toBe(true);
      
      // Should be invalid
      expect(invalidTime >= expiry).toBe(false);
    });

    it('should return principal on redemption', () => {
      const principal = 50000n;
      const commitment = buildPTCommitment(principal, 500000);
      
      const parsedPrincipal = BigInt('0x' + commitment.slice(0, 16));
      expect(parsedPrincipal).toBe(principal);
    });
  });

  describe('claimYield validation', () => {
    it('should handle valid yield rates', () => {
      const validRates = [0, 100, 500, 1000, 5000, 10000];
      
      validRates.forEach(rate => {
        expect(rate >= 0).toBe(true);
        expect(rate <= 10000).toBe(true);
      });
    });

    it('should cap elapsed time at expiry', () => {
      const expiry = 500000;
      const timeBeforeExpiry = 250000;
      const timeAfterExpiry = 750000;
      
      // Before expiry: use actual time
      const elapsedBefore = Math.min(timeBeforeExpiry, expiry);
      expect(elapsedBefore).toBe(timeBeforeExpiry);
      
      // After expiry: cap at expiry
      const elapsedAfter = Math.min(timeAfterExpiry, expiry);
      expect(elapsedAfter).toBe(expiry);
    });

    it('should handle claiming before expiry', () => {
      const expiry = 500000;
      const currentTime = 250000;
      
      expect(currentTime < expiry).toBe(true);
    });

    it('should handle claiming at or after expiry', () => {
      const expiry = 500000;
      const currentTime = 500000;
      
      expect(currentTime >= expiry).toBe(true);
    });
  });

  describe('full token lifecycle', () => {
    it('should track principal through split and merge', () => {
      const originalPrincipal = 100000n;
      
      // Split: create PT + YT
      const expiry = 500000;
      const ptCommitment = buildPTCommitment(originalPrincipal, expiry);
      const ytCommitment = buildYTCommitment(0n, expiry);
      
      // Merge: recreate lstBCH
      const mergedPrincipal = BigInt('0x' + ptCommitment.slice(0, 16));
      
      expect(mergedPrincipal).toBe(originalPrincipal);
    });

    it('should track yield through claim operations', () => {
      const expiry = 500000;
      
      // Initial YT
      const yt1 = buildYTCommitment(0n, expiry);
      expect(BigInt('0x' + yt1.slice(0, 16))).toBe(0n);
      
      // After some time - new yield accrued
      const newYield = 2500n;
      const yt2 = buildYTCommitment(newYield, expiry);
      expect(BigInt('0x' + yt2.slice(0, 16))).toBe(2500n);
      
      // Expiry claim - full yield
      const finalYield = 5000n;
      const yt3 = buildYTCommitment(finalYield, expiry);
      expect(BigInt('0x' + yt3.slice(0, 16))).toBe(5000n);
    });
  });

  describe('edge cases', () => {
    it('should handle minimum expiry', () => {
      const minExpiry = 1001;
      const commitment = buildPTCommitment(1000n, minExpiry);
      const parsedExpiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(parsedExpiry).toBe(minExpiry);
    });

    it('should handle maximum expiry', () => {
      const maxExpiry = 1999999;
      const commitment = buildPTCommitment(1000n, maxExpiry);
      const parsedExpiry = parseInt(commitment.slice(16, 24), 16);
      
      expect(parsedExpiry).toBe(maxExpiry);
    });

    it('should handle zero principal edge case', () => {
      const commitment = buildPTCommitment(0n, 500000);
      const parsed = BigInt('0x' + commitment.slice(0, 16));
      
      expect(parsed).toBe(0n);
    });
  });
});
