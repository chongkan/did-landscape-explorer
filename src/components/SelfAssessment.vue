<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMethodsData } from '@/composables/useMethodsData'
import { REQUIREMENTS, REQUIREMENTS_MAP } from '@/config/requirements'
import { FEATURE_DEFINITIONS } from '@/config/taxonomy'
import type { AssessmentStatus, UseCase, UseCaseCategory, MethodEntry, SigningMethod, Methodology } from '@/types/method'
import { REGISTRY_TYPES } from '@/config/taxonomy'
import { repoZipUrl } from '@/config/urls'

const { methods, useCases, loadAll } = useMethodsData()
onMounted(loadAll)

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

const step = ref(1)
const STEPS = [
  { num: 1, label: 'Identity' },
  { num: 2, label: 'Method Info' },
  { num: 3, label: 'Use Case' },
  { num: 4, label: 'Features' },
  { num: 5, label: 'Requirements' },
  { num: 6, label: 'Review' },
]

// ---------------------------------------------------------------------------
// Identity (Step 1)
// ---------------------------------------------------------------------------

const contributorDid = ref('')
const signingMethod = ref<SigningMethod | null>(null)
const contributorName = ref('')
const llmModel = ref('')
const methodology = ref<Methodology>('manual')
const revisionNotes = ref('')
const identityConnected = ref(false)
const identityConnecting = ref(false)

type ConnectFlow = 'wallet' | 'extension' | 'github' | 'anonymous' | 'paste'

const CONNECT_OPTIONS: { key: ConnectFlow; label: string; description: string; icon: string; didMethod: SigningMethod; available: boolean }[] = [
  { key: 'wallet', label: 'Connect Wallet', description: 'MetaMask, Phantom, or any Web3 wallet — your address becomes your DID', icon: '⛓', didMethod: 'did:pkh', available: true },
  { key: 'extension', label: 'Identity Wallet', description: 'Present a credential from any W3C-compatible identity wallet extension', icon: '🛡', didMethod: 'custom', available: true },
  { key: 'github', label: 'GitHub Account', description: 'Authenticate with GitHub — we derive a did:web for you on this project', icon: '⌥', didMethod: 'did:web', available: false },
]

const selectedFlow = ref<ConnectFlow | null>(null)
const chapiNoHandler = ref(false)

/** Connect identity wallet via W3C Credential Handler API (CHAPI) */
async function connectIdentityWallet() {
  identityConnecting.value = true
  chapiNoHandler.value = false
  try {
    // Build a DIDAuthentication VP request per W3C CHAPI / Credential Handler API
    const vpRequest = {
      web: {
        VerifiablePresentation: {
          query: { type: 'DIDAuthentication' },
          challenge: `did-landscape-${Date.now().toString(36)}`,
          domain: window.location.origin,
        },
      },
    }
    const credential = await navigator.credentials.get(vpRequest as unknown as globalThis.CredentialRequestOptions)
    if (credential && 'data' in credential) {
      const vp = (credential as { data: Record<string, unknown> }).data
      // Extract the holder DID from the VP
      const holderDid = (vp.holder as string) ?? ''
      if (holderDid.startsWith('did:')) {
        contributorDid.value = holderDid
        // Detect signing method from DID prefix
        const methodPrefix = holderDid.split(':').slice(0, 2).join(':') as SigningMethod
        signingMethod.value = (['did:key', 'did:web', 'did:pkh', 'did:ens', 'did:sns'] as SigningMethod[]).includes(methodPrefix)
          ? methodPrefix
          : 'custom'
        identityConnected.value = true
        return
      }
    }
    // credentials.get returned null → no handler responded
    chapiNoHandler.value = true
    identityConnected.value = false
  } catch {
    // NotAllowedError, AbortError, or no CHAPI polyfill → no handler
    chapiNoHandler.value = true
    identityConnected.value = false
  } finally {
    identityConnecting.value = false
  }
}

/** Connect wallet via window.ethereum or window.solana */
async function connectWallet() {
  identityConnecting.value = true
  try {
    const eth = (window as unknown as Record<string, unknown>).ethereum as { request: (args: { method: string }) => Promise<string[]> } | undefined
    if (eth) {
      const accounts = await eth.request({ method: 'eth_requestAccounts' })
      if (accounts[0]) {
        contributorDid.value = `did:pkh:eip155:1:${accounts[0]}`
        signingMethod.value = 'did:pkh'
        identityConnected.value = true
        return
      }
    }
    const sol = (window as unknown as Record<string, unknown>).solana as { connect: () => Promise<{ publicKey: { toString: () => string } }> } | undefined
    if (sol) {
      const resp = await sol.connect()
      contributorDid.value = `did:pkh:solana:${resp.publicKey.toString()}`
      signingMethod.value = 'did:pkh'
      identityConnected.value = true
      return
    }
    // No wallet found
    contributorDid.value = ''
    identityConnected.value = false
  } catch {
    identityConnected.value = false
  } finally {
    identityConnecting.value = false
  }
}

/** Handle flow selection */
function selectFlow(flow: ConnectFlow) {
  selectedFlow.value = flow
  identityConnected.value = false
  contributorDid.value = ''
  signingMethod.value = null

  if (flow === 'wallet') {
    connectWallet()
  } else if (flow === 'extension') {
    connectIdentityWallet()
  }
  // 'github' waits for Phase 4 integration
}

const METHODOLOGIES: { key: Methodology; label: string; description: string }[] = [
  { key: 'manual', label: 'Manual Review', description: 'You read the spec and assessed it yourself' },
  { key: 'llm-assisted', label: 'LLM-Assisted', description: 'You used an LLM to help analyse the spec' },
  { key: 'automated', label: 'Fully Automated', description: 'An LLM or tool generated the entire assessment' },
  { key: 'hybrid', label: 'Team / Hybrid', description: 'Multiple people and/or models collaborated' },
]

// ---------------------------------------------------------------------------
// Method Info (Step 2)
// ---------------------------------------------------------------------------

const methodName = ref('')
const specUrl = ref('')
const repoUrl = ref('')
const blockchain = ref('')
const registryType = ref('blockchain')
const contactName = ref('')

// ---------------------------------------------------------------------------
// Use Case (Step 2)
// ---------------------------------------------------------------------------

const selectedUseCaseId = ref<string | null>(null)
const audienceFilter = ref<string | null>(null)

const catNames: Record<string, string> = {
  'CAT-FIN': 'Finance & Commerce',
  'CAT-GOV': 'Government & Legal',
  'CAT-EDU': 'Education & Skills',
  'CAT-HEALTH': 'Healthcare',
  'CAT-INFRA': 'Infrastructure & Supply Chain',
  'CAT-PRIVACY': 'Privacy & Communication',
}

const categories = computed<UseCaseCategory[]>(() => {
  const catMap = new Map<string, UseCaseCategory>()
  for (const uc of useCasesList.value) {
    if (!catMap.has(uc.category)) {
      catMap.set(uc.category, { id: uc.category, name: catNames[uc.category] ?? uc.category, description: '' })
    }
  }
  return Array.from(catMap.values())
})

const useCasesList = computed<UseCase[]>(() =>
  useCases.value.map(uc => ({
    ...uc,
    requiredRequirements: uc.requiredRequirements ?? uc.requirements ?? [],
    description: uc.description ?? '',
    w3cSection: uc.w3cSection ?? '',
    detailLevel: uc.detailLevel ?? 'brief',
    detailUrl: uc.detailUrl ?? null,
    industries: uc.industries ?? [],
    actors: uc.actors ?? [],
    tags: uc.tags ?? [],
  }))
)

const selectedUseCase = computed(() =>
  useCasesList.value.find(uc => uc.id === selectedUseCaseId.value) ?? null
)

const useCaseRequirements = computed(() => {
  if (!selectedUseCase.value) return []
  return selectedUseCase.value.requiredRequirements.map(id => REQUIREMENTS_MAP[id]).filter(Boolean)
})

const AUDIENCES = [
  { key: 'Persons', match: ['consumer', 'patient', 'student', 'user', 'worker', 'citizen', 'holder', 'resident', 'sender', 'receiver'] },
  { key: 'Business', match: ['corporation', 'employer', 'firm', 'manufacturer', 'merchant', 'supplier', 'importer'] },
  { key: 'Enterprise', match: ['enterprise', 'regulator', 'auditor', 'court', 'public-authority', 'customs-authority'] },
]

function useCaseMatchesAudience(uc: UseCase): boolean {
  if (!audienceFilter.value) return true
  const aud = AUDIENCES.find(a => a.key === audienceFilter.value)
  if (!aud) return true
  return uc.actors.some(actor => aud.match.includes(actor))
}

function useCasesForCategory(catId: string): UseCase[] {
  return useCasesList.value.filter(uc => uc.category === catId).filter(useCaseMatchesAudience)
}

const INDUSTRY_LABELS: Record<string, { short: string; color: string }> = {
  'cross-border-finance': { short: 'Finance', color: 'text-emerald-400 border-emerald-400/30' },
  'banking-kyc': { short: 'Banking', color: 'text-blue-400 border-blue-400/30' },
  'defi-identity': { short: 'DeFi', color: 'text-purple-400 border-purple-400/30' },
  'government-eid': { short: 'Gov', color: 'text-amber-400 border-amber-400/30' },
  'academic-credentials': { short: 'Edu', color: 'text-cyan-400 border-cyan-400/30' },
  'patient-health': { short: 'Health', color: 'text-red-400 border-red-400/30' },
  'messaging': { short: 'Comms', color: 'text-green-400 border-green-400/30' },
  'supply-chain': { short: 'Supply', color: 'text-orange-400 border-orange-400/30' },
  'social-media': { short: 'Social', color: 'text-pink-400 border-pink-400/30' },
  'iot-devices': { short: 'IoT', color: 'text-teal-400 border-teal-400/30' },
  'enterprise': { short: 'Enterprise', color: 'text-indigo-400 border-indigo-400/30' },
}
function previewIndustryLabel(ind: string): string { return INDUSTRY_LABELS[ind]?.short ?? ind }
function previewIndustryColor(ind: string): string { return INDUSTRY_LABELS[ind]?.color ?? 'text-gray-300 border-gray-600' }

const FEATURE_LABELS: Record<string, string> = {
  create: 'Create', read: 'Read', update: 'Update', deactivate: 'Deactivate',
  keyRotation: 'Key Rotation', didLog: 'DID Log', recovery: 'Recovery', multiSig: 'Multi-Sig',
  vc: 'VCs', sd: 'Selective Disclosure', didcomm: 'DIDComm', resolver: 'Resolver',
  jsonld: 'JSON-LD', privacy: 'Privacy',
}
const CRYPTO_LABELS: Record<string, string> = {
  ed25519: 'Ed25519', secp256k1: 'secp256k1', p256: 'P-256', bls: 'BLS', pq: 'Post-Quantum',
}
function previewFeatureLabel(key: string): string { return FEATURE_LABELS[key] ?? key }
function previewCryptoLabel(key: string): string { return CRYPTO_LABELS[key] ?? key }

const coveringMethods = computed(() => {
  if (!selectedUseCase.value) return []
  const reqIds = selectedUseCase.value.requiredRequirements
  return methods.value
    .filter(m => reqIds.some(id => m.reqMet.includes(id)))
    .sort((a, b) => {
      const aCov = reqIds.filter(id => a.reqMet.includes(id)).length
      const bCov = reqIds.filter(id => b.reqMet.includes(id)).length
      return bCov - aCov
    })
    .slice(0, 10)
})

const previewMethod = ref<MethodEntry | null>(null)

// ---------------------------------------------------------------------------
// Features (Step 3)
// ---------------------------------------------------------------------------

const features = ref<Record<string, boolean | null>>(
  Object.fromEntries(FEATURE_DEFINITIONS.map(f => [f.key, null]))
)

// ---------------------------------------------------------------------------
// Requirements (Step 4)
// ---------------------------------------------------------------------------

const assessments = ref<Record<string, { status: AssessmentStatus; approach: string; evidence: string }>>(
  Object.fromEntries(REQUIREMENTS.map(r => [r.id, { status: 'not-assessed' as AssessmentStatus, approach: '', evidence: '' }]))
)

const STATUS_OPTIONS: { value: AssessmentStatus; label: string; color: string }[] = [
  { value: 'met', label: 'Met', color: 'text-status-met' },
  { value: 'partial', label: 'Partial', color: 'text-status-partial' },
  { value: 'not-met', label: 'Not Met', color: 'text-status-not-met' },
  { value: 'not-applicable', label: 'N/A', color: 'text-description' },
  { value: 'not-assessed', label: 'Skip', color: 'text-dim' },
]

const assessedCount = computed(() => Object.values(assessments.value).filter(a => a.status !== 'not-assessed').length)
const metCount = computed(() => Object.values(assessments.value).filter(a => a.status === 'met').length)

// ---------------------------------------------------------------------------
// Export (Step 5)
// ---------------------------------------------------------------------------

const showExport = ref(false)

const exportJson = computed(() => {
  const reqs: Record<string, object> = {}
  for (const [id, a] of Object.entries(assessments.value)) {
    if (a.status !== 'not-assessed') {
      reqs[id] = { status: a.status, approach: a.approach || undefined, evidence: a.evidence || undefined, submittedBy: contactName.value || undefined, verified: false }
    }
  }
  const feat: Record<string, boolean | null> = {}
  for (const [k, v] of Object.entries(features.value)) feat[k] = v

  return JSON.stringify({
    method: methodName.value || 'did:your-method',
    specUrl: specUrl.value || undefined,
    repoUrl: repoUrl.value || undefined,
    blockchain: blockchain.value || undefined,
    registryType: registryType.value,
    assessed: true,
    useCase: selectedUseCase.value?.id ?? undefined,
    requirements: reqs,
    feat,
    revision: {
      id: `rev-${Date.now().toString(36)}`,
      contributor: {
        did: contributorDid.value || `did:key:pending`,
        method: signingMethod.value ?? 'did:key',
        displayName: contributorName.value || contactName.value || undefined,
      },
      model: llmModel.value || null,
      methodology: methodology.value,
      date: new Date().toISOString(),
      notes: revisionNotes.value || undefined,
    },
  }, null, 2)
})

const saved = ref(false)
const STORAGE_KEY = 'did-landscape-assessment-draft'

function saveToLocal() {
  localStorage.setItem(STORAGE_KEY, exportJson.value)
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}

function downloadJson() {
  const name = methodName.value.trim().replace(/[^a-z0-9_-]/gi, '-') || 'assessment'
  const blob = new Blob([exportJson.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-assessment.json`
  a.click()
  URL.revokeObjectURL(url)
}

function loadFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    if (data.revision?.contributor?.did) {
      contributorDid.value = data.revision.contributor.did
      identityConnected.value = true
    }
    if (data.revision?.contributor?.method) signingMethod.value = data.revision.contributor.method
    if (data.revision?.contributor?.displayName) contributorName.value = data.revision.contributor.displayName
    if (data.revision?.model) llmModel.value = data.revision.model
    if (data.revision?.methodology) methodology.value = data.revision.methodology
    if (data.revision?.notes) revisionNotes.value = data.revision.notes
    if (data.method) methodName.value = data.method
    if (data.specUrl) specUrl.value = data.specUrl
    if (data.repoUrl) repoUrl.value = data.repoUrl
    if (data.blockchain) blockchain.value = data.blockchain
    if (data.registryType) registryType.value = data.registryType
    if (data.submittedBy?.name) contactName.value = data.submittedBy.name
    if (data.revision?.contributor?.displayName) contactName.value = data.revision.contributor.displayName
    if (data.useCase) selectedUseCaseId.value = data.useCase
    if (data.feat) {
      for (const [k, v] of Object.entries(data.feat)) {
        if (k in features.value) features.value[k] = v as boolean | null
      }
    }
    if (data.requirements) {
      for (const [id, val] of Object.entries(data.requirements)) {
        const r = val as { status?: string; approach?: string; evidence?: string }
        if (id in assessments.value) {
          if (r.status) assessments.value[id].status = r.status as AssessmentStatus
          if (r.approach) assessments.value[id].approach = r.approach
          if (r.evidence) assessments.value[id].evidence = r.evidence
        }
      }
    }
  } catch { /* ignore corrupt data */ }
}

const hasSavedDraft = computed(() => localStorage.getItem(STORAGE_KEY) !== null)

function fillDummy() {
  selectedFlow.value = 'wallet'
  signingMethod.value = 'did:pkh'
  contributorDid.value = 'did:pkh:solana:ATTEstto1234567890abcdef'
  identityConnected.value = true
  contributorName.value = 'Eduardo Chongkan'
  methodology.value = 'llm-assisted'
  llmModel.value = 'Claude Opus 4'
  methodName.value = 'did:sns'
  specUrl.value = 'https://spec.attestto.com/did-sns/'
  repoUrl.value = 'https://github.com/Attestto-com/did-sns-spec'
  blockchain.value = 'Solana'
  registryType.value = 'blockchain'
  contactName.value = 'Eduardo Chongkan'
  selectedUseCaseId.value = 'UC-ENT'

  // Features — did:sns actual capabilities
  const snsFeatures: Record<string, boolean> = {
    create: false, read: false, update: false, deactivate: false,
    keyRotation: true, didLog: false, recovery: true, multiSig: true,
    vc: true, sd: true, didcomm: true, resolver: true, jsonld: true, privacy: true,
  }
  for (const f of FEATURE_DEFINITIONS) {
    features.value[f.key] = snsFeatures[f.key] ?? null
  }

  // Requirements — did:sns meets all 22
  const approaches: Record<string, string> = {
    R1: 'Ed25519, secp256k1, ML-DSA-44 signatures via DID Document keys',
    R2: 'Controller creates DID via SNS domain registration on Solana',
    R3: 'Solana Name Service enforces global uniqueness',
    R4: 'Resolution reads from Solana on-chain registry',
    R5: 'DID Document contains Ed25519/secp256k1/ML-DSA verification methods',
    R6: 'Keys replaced in DID Document without changing the DID',
    R7: 'Service endpoints: DIDCommMessaging, CredentialExchange, LinkedDomains',
    R8: 'No PII on-chain, SD-JWT selective disclosure, pairwise subdomains',
    R9: 'DID Document controller + delegation properties, multi-sig',
    R10: 'Works globally via Solana, no jurisdiction-specific infra',
    R11: 'Decentralized — no single authority can revoke',
    R12: 'Minimal SOL for SNS domain, no recurring fees',
    R13: 'W3C DID Core compliant, open-source tooling, Universal Resolver',
    R14: 'Pairwise subdomain DIDs via SHA-256(verifierDID + holderSecret)',
    R15: 'ML-DSA-44 and ML-KEM-768 post-quantum key types defined',
    R16: 'On-chain data persists regardless of issuer status',
    R17: 'Multiple resolver implementations, not tied to single deployment',
    R18: 'Controller retains keys via Solana wallet, independent of provider',
    R19: 'DIDComm v2 authenticated encrypted messaging',
    R20: 'Cross-chain via alsoKnownAs with did:ens, did:pkh, did:web',
    R21: 'vLEI bridge for legal identity binding via verifiable credential',
    R22: 'Human-readable SNS domain names (e.g., alice.sol)',
  }
  for (const r of REQUIREMENTS) {
    assessments.value[r.id] = {
      status: 'met',
      approach: approaches[r.id] ?? 'Defined in spec',
      evidence: 'https://spec.attestto.com/did-sns/',
    }
  }
}

function canAdvance(): boolean {
  if (step.value === 1) return identityConnected.value && contributorDid.value.startsWith('did:')
  if (step.value === 2) return methodName.value.trim().length > 0
  if (step.value === 3) return selectedUseCaseId.value != null
  return true
}
</script>

<template>
  <div class="space-y-4">
    <!-- Status bar -->
    <div class="card-stat px-5 py-2.5 flex items-center justify-between text-sm" style="text-align: left;">
      <div class="flex items-center gap-5 text-description text-xs">
        <span v-if="contributorDid || signingMethod">Signer: <strong class="text-primary font-mono">{{ contributorDid || signingMethod || '—' }}</strong></span>
        <span>Method: <strong class="text-primary">{{ methodName || 'not set' }}</strong></span>
        <span v-if="selectedUseCase">Use Case: <strong class="text-primary">{{ selectedUseCase.name }}</strong></span>
        <span v-if="methodology !== 'manual'">Via: <strong class="text-primary">{{ methodology }}{{ llmModel ? ' · ' + llmModel : '' }}</strong></span>
      </div>
      <div class="flex gap-2">
        <button
          v-if="hasSavedDraft && step <= 2"
          class="btn-accent"
          @click="loadFromLocal"
        >Resume Draft</button>
        <template v-if="step > 2">
          <button
            :class="saved ? 'btn-success' : 'btn-success'"
            @click="saveToLocal"
          >{{ saved ? 'Saved!' : 'Save' }}</button>
          <button
            class="btn-outline"
            @click="downloadJson"
          >Download JSON</button>
        </template>
      </div>
    </div>

    <!-- Step indicators -->
    <div class="grid grid-cols-6 gap-2">
      <button
        v-for="s in STEPS"
        :key="s.num"
        class="wizard-step text-left transition-colors"
        :class="step === s.num
          ? 'wizard-step--active'
          : s.num < step
            ? 'wizard-step--done'
            : ''"
        @click="s.num <= step + 1 && (step = s.num)"
      >
        <span class="wizard-step__number text-base font-bold mr-1.5">{{ s.num }}</span>
        <span class="wizard-step__label">{{ s.label }}</span>
      </button>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 1: IDENTITY -->
    <!-- ================================================================ -->
    <div v-if="step === 1" class="card space-y-5">
      <div>
        <h2 class="text-subsection mb-1">Authenticate</h2>
        <p class="text-help text-dim">
          Connect your identity to sign this assessment. Your DID will be publicly linked to this
          revision, creating a verifiable chain of contributions.
        </p>
      </div>

      <!-- Connection options -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          v-for="opt in CONNECT_OPTIONS"
          :key="opt.key"
          class="identity-card"
          :class="[
            selectedFlow === opt.key ? 'identity-card--active' : 'identity-card--inactive',
            !opt.available ? 'opacity-50 cursor-not-allowed' : ''
          ]"
          :disabled="!opt.available"
          @click="opt.available && selectFlow(opt.key)"
        >
          <span class="text-xl">{{ opt.icon }}</span>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-secondary">{{ opt.label }}</span>
              <span v-if="!opt.available" class="tier-badge tier-badge--special">Soon</span>
            </div>
            <div class="text-[10px] text-dim leading-tight mt-0.5">{{ opt.description }}</div>
          </div>
        </button>
      </div>

      <!-- Connected state -->
      <div v-if="identityConnected && contributorDid" class="callout-success">
        <p class="callout__title">Connected</p>
        <p class="callout__body font-mono break-all">{{ contributorDid }}</p>
      </div>

      <!-- Connecting state -->
      <div v-else-if="identityConnecting" class="callout-info">
        <p class="callout__body">Connecting to wallet...</p>
      </div>

      <!-- Wallet not found -->
      <div v-else-if="selectedFlow === 'wallet' && !identityConnecting && !identityConnected" class="callout-warning">
        <p class="callout__title">No wallet detected</p>
        <p class="callout__body">
          Install a Web3 wallet extension (MetaMask, Phantom, etc.) and reload this page.
        </p>
        <button class="btn-outline mt-2" @click="connectWallet">Retry</button>
      </div>

      <!-- Identity wallet: no handler detected — install promo -->
      <div v-else-if="selectedFlow === 'extension' && chapiNoHandler && !identityConnecting" class="space-y-3">
        <div class="callout-warning">
          <p class="callout__title">No identity wallet detected</p>
          <p class="callout__body">
            No W3C Credential Handler responded. Install a compatible identity wallet extension
            to present your DID credential.
          </p>
        </div>

        <!-- Attestto Vault branded promo (like Phantom install promo pattern) -->
        <div class="identity-card identity-card--inactive" style="border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 6%, transparent);">
          <div class="flex items-center gap-3 w-full">
            <span class="text-2xl">🔐</span>
            <div class="flex-1">
              <div class="text-xs font-semibold text-secondary">Attestto Vault</div>
              <div class="text-[10px] text-dim leading-tight mt-0.5">
                Self-sovereign identity wallet with DIDComm v2, selective disclosure, and W3C Credential API support.
              </div>
            </div>
            <a
              href="https://github.com/nicholasgriffintn/nicholasgriffintn"
              target="_blank"
              class="btn-accent text-xs whitespace-nowrap"
            >Install Extension</a>
          </div>
        </div>

        <p class="text-dim text-[10px] text-center">
          Or use any W3C
          <a href="https://w3c-ccg.github.io/credential-handler-api/" target="_blank" class="text-status-info hover:underline">Credential Handler API</a>
          compatible wallet — Spruce, Trinsic, Walt.id, etc.
        </p>

        <button class="btn-outline w-full" @click="connectIdentityWallet">
          Retry Detection
        </button>
      </div>

      <!-- Display name -->
      <div>
        <label class="input-label">Display name <span class="text-dim">(optional)</span></label>
        <input
          v-model="contributorName"
          type="text"
          placeholder="How you'd like to be credited"
          class="input-compact--text"
        />
      </div>

      <!-- Methodology -->
      <div>
        <h3 class="text-label font-semibold mb-2">Methodology</h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="m in METHODOLOGIES"
            :key="m.key"
            class="identity-card"
            :class="methodology === m.key ? 'identity-card--active' : 'identity-card--inactive'"
            @click="methodology = m.key"
          >
            <div>
              <div class="text-xs font-semibold text-secondary">{{ m.label }}</div>
              <div class="text-[10px] text-dim leading-tight">{{ m.description }}</div>
            </div>
          </button>
        </div>
      </div>

      <!-- LLM model (shown when methodology involves LLM) -->
      <div v-if="methodology === 'llm-assisted' || methodology === 'automated' || methodology === 'hybrid'">
        <label class="input-label">LLM model used</label>
        <input
          v-model="llmModel"
          type="text"
          placeholder="e.g. Claude Opus 4, GPT-4o, Gemini..."
          class="input-compact--text"
        />
      </div>

      <!-- Notes -->
      <div>
        <label class="input-label">Revision notes <span class="text-dim">(optional)</span></label>
        <input
          v-model="revisionNotes"
          type="text"
          placeholder="e.g. Reviewed spec v2.1, sections 3-7"
          class="input-compact--text"
        />
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 2: METHOD INFO -->
    <!-- ================================================================ -->
    <div v-else-if="step === 2" class="card">
      <h2 class="text-subsection mb-4">Method Information</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label class="input-label">Method name *</label>
          <input v-model="methodName" type="text" placeholder="did:your-method"
            class="input-compact" />
        </div>
        <div>
          <label class="input-label">Registry type</label>
          <select v-model="registryType" class="input-compact--text">
            <option value="blockchain">Blockchain</option>
            <option value="web">Web</option>
            <option value="peer">Peer</option>
            <option value="ledger">Ledger</option>
            <option value="generative">Generative</option>
            <option value="hybrid">Hybrid</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label class="input-label">Registry Type Details</label>
          <input v-model="blockchain" type="text"
            :placeholder="registryType === 'blockchain' ? 'e.g. Ethereum, Solana...'
              : registryType === 'web' ? 'e.g. domain-based, DNS...'
              : registryType === 'peer' ? 'e.g. peer-to-peer protocol...'
              : registryType === 'ledger' ? 'e.g. Indy, Hyperledger...'
              : registryType === 'generative' ? 'e.g. derived from key material...'
              : registryType === 'hybrid' ? 'e.g. web + crypto log...'
              : 'Describe your registry type...'"
            class="input-compact--text" />
        </div>
        <div>
          <label class="input-label">Specification URL</label>
          <input v-model="specUrl" type="url" placeholder="https://..."
            class="input-compact--text" />
        </div>
        <div>
          <label class="input-label">Repository URL</label>
          <input v-model="repoUrl" type="url" placeholder="https://github.com/..."
            class="input-compact--text" />
        </div>
        <div>
          <label class="input-label">Your name</label>
          <input v-model="contactName" type="text" placeholder="For attribution"
            class="input-compact--text" />
        </div>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 2: USE CASE (v1 compact layout) -->
    <!-- ================================================================ -->
    <div v-else-if="step === 3" class="card px-5 py-4">
      <div class="flex items-baseline justify-between mb-3">
        <div class="flex items-baseline gap-2">
          <h2 class="text-subsection">Select a use case</h2>
          <span class="text-help text-dim">— this determines which requirements apply</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-help text-dim mr-1">Filter by audience:</span>
          <button
            v-for="aud in AUDIENCES"
            :key="aud.key"
            class="audience-pill"
            :class="audienceFilter === aud.key
              ? 'audience-pill--active'
              : 'audience-pill--inactive'"
            @click="audienceFilter = audienceFilter === aud.key ? null : aud.key"
          >{{ aud.key }}</button>
        </div>
      </div>

      <div class="grid grid-cols-[240px_1fr] gap-4">
        <!-- Left: categorized list -->
        <div class="space-y-2 overflow-y-auto max-h-[460px] pr-1 border-r border-gray-700/50">
          <div v-for="cat in categories" :key="cat.id">
            <h3 class="uc-category-heading">{{ cat.name }}</h3>
            <button
              v-for="uc in useCasesForCategory(cat.id)"
              :key="uc.id"
              class="uc-item"
              :class="selectedUseCaseId === uc.id
                ? 'uc-item--active'
                : 'uc-item--inactive'"
              @click="selectedUseCaseId = uc.id"
            >
              <span class="truncate">{{ uc.name }}</span>
              <span class="text-[10px] text-dim tabular-nums ml-2 shrink-0">{{ uc.requiredRequirements.length }}</span>
            </button>
          </div>

        </div>

        <!-- Right: detail -->
        <div v-if="selectedUseCase" class="space-y-3">
          <div>
            <h3 class="text-lg font-bold text-primary">{{ selectedUseCase.name }}</h3>
            <p class="text-description mt-1">{{ selectedUseCase.description }}</p>
          </div>

          <!-- Actors + W3C link -->
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-for="actor in selectedUseCase.actors"
              :key="actor"
              class="actor-badge"
              :class="AUDIENCES.some(a => a.match.includes(actor))
                ? 'actor-badge--matched'
                : 'actor-badge--default'"
            >{{ actor }}</span>
            <a
              v-if="selectedUseCase.detailUrl"
              :href="selectedUseCase.detailUrl"
              target="_blank"
              class="link ml-auto"
            >W3C Reference &#8599;</a>
          </div>

          <!-- Covering methods -->
          <div v-if="coveringMethods.length">
            <h4 class="text-label font-semibold mb-1">
              Methods Addressing This Use Case
            </h4>
            <div class="flex flex-wrap gap-1">
              <button
                v-for="cm in coveringMethods"
                :key="cm.method"
                class="method-pill"
                @click="previewMethod = cm"
              >{{ cm.method }}</button>
            </div>
          </div>

          <!-- Required capabilities (compact) -->
          <div>
            <h4 class="text-label font-semibold mb-1.5">
              Required Capabilities ({{ useCaseRequirements.length }})
            </h4>
            <div class="rounded border border-gray-700 divide-y divide-gray-700/50">
              <div
                v-for="req in useCaseRequirements"
                :key="req.id"
                class="flex items-center gap-2 px-3 py-1.5"
              >
                <span class="text-requirement-id w-6">{{ req.id }}</span>
                <span class="text-description flex-1">{{ req.name }}</span>
                <span
                  class="tier-badge"
                  :class="{
                    'tier-badge--core': req.tier === 'core',
                    'tier-badge--common': req.tier === 'common',
                    'tier-badge--special': req.tier === 'specialized',
                  }"
                >{{ req.tier }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flex items-center justify-center text-muted text-sm">
          Select a use case from the list to see its requirements
        </div>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 3: FEATURES -->
    <!-- ================================================================ -->
    <div v-else-if="step === 4" class="card">
      <h2 class="text-subsection mb-4">Feature Support</h2>
      <p class="text-help text-dim mb-4">
        Mark which capabilities your method supports. Leave unset if unknown.
      </p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        <div
          v-for="feat in FEATURE_DEFINITIONS"
          :key="feat.key"
          class="feat-card"
          :class="features[feat.key] === true ? 'feat-card--yes'
            : features[feat.key] === false ? 'feat-card--no'
            : 'feat-card--unset'"
        >
          <div class="flex items-center justify-between mb-0.5">
            <span class="text-xs font-medium text-secondary">{{ feat.label }}</span>
            <div class="flex gap-0.5">
              <button
                class="feat-toggle"
                :class="features[feat.key] === true ? 'feat-toggle--yes' : ''"
                @click="features[feat.key] = features[feat.key] === true ? null : true"
              >&#10003;</button>
              <button
                class="feat-toggle"
                :class="features[feat.key] === false ? 'feat-toggle--no' : ''"
                @click="features[feat.key] = features[feat.key] === false ? null : false"
              >&#10007;</button>
            </div>
          </div>
          <p class="text-[10px] text-dim leading-tight">{{ feat.description }}</p>
        </div>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 4: REQUIREMENTS -->
    <!-- ================================================================ -->
    <div v-else-if="step === 5" class="space-y-3">
      <!-- Progress -->
      <div class="card-stat px-4 py-3 flex items-center gap-4 text-left">
        <span class="text-xs text-description font-medium shrink-0">Progress</span>
        <div class="progress-track">
          <div
            :class="assessedCount === REQUIREMENTS.length ? 'progress-fill progress-fill--complete' : 'progress-fill progress-fill--active'"
            :style="{ width: Math.round((assessedCount / REQUIREMENTS.length) * 100) + '%' }"
          ></div>
        </div>
        <span class="text-xs text-muted shrink-0 tabular-nums">
          {{ assessedCount }}/{{ REQUIREMENTS.length }}
          &middot; <span class="text-status-met">{{ metCount }} met</span>
        </span>
      </div>

      <!-- Requirements -->
      <div
        v-for="req in REQUIREMENTS"
        :key="req.id"
        class="req-card"
        :class="assessments[req.id].status === 'met' ? 'req-card--met'
          : assessments[req.id].status === 'partial' ? 'req-card--partial'
          : assessments[req.id].status === 'not-met' ? 'req-card--not-met'
          : 'req-card--default'"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span class="text-requirement-id shrink-0">{{ req.id }}</span>
            <span class="text-sm text-primary font-medium truncate">{{ req.name }}</span>
            <span
              class="tier-badge shrink-0"
              :class="{
                'tier-badge--core': req.tier === 'core',
                'tier-badge--common': req.tier === 'common',
                'tier-badge--special': req.tier === 'specialized',
              }"
            >{{ req.tier }}</span>
            <span
              v-if="selectedUseCase?.requiredRequirements.includes(req.id)"
              class="required-tag"
            >required</span>
          </div>
          <div class="flex gap-1 shrink-0">
            <button
              v-for="opt in STATUS_OPTIONS"
              :key="opt.value"
              class="status-toggle"
              :class="assessments[req.id].status === opt.value
                ? opt.color + ' status-toggle--active'
                : ''"
              @click="assessments[req.id].status = opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>
        <p class="card-stat-label">{{ req.description }}</p>
        <template v-if="assessments[req.id].status !== 'not-assessed'">
          <div class="grid grid-cols-2 gap-2">
            <input
              v-model="assessments[req.id].approach"
              type="text"
              placeholder="How does your method address this?"
              class="input-evidence"
            />
            <input
              v-model="assessments[req.id].evidence"
              type="url"
              placeholder="Evidence URL (spec section, code...)"
              class="input-evidence"
            />
          </div>
        </template>
      </div>
    </div>

    <!-- ================================================================ -->
    <!-- STEP 5: REVIEW -->
    <!-- ================================================================ -->
    <div v-else-if="step === 6" class="card space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-subsection">Review &amp; Export</h2>
          <p class="text-help text-dim mt-1">
            Copy the JSON and submit as a PR to <code class="code-inline">w3c/did-extensions</code>
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="btn-outline"
            @click="showExport = !showExport"
          >{{ showExport ? 'Hide' : 'Preview' }} JSON</button>
          <button
            class="btn-success"
            @click="saveToLocal"
          >{{ saved ? 'Saved!' : 'Save' }}</button>
          <button
            class="btn-primary"
            @click="downloadJson"
          >Download JSON</button>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="review-stat">
          <div class="text-lg font-bold text-primary font-mono">{{ methodName || '—' }}</div>
          <div class="card-stat-label">Method</div>
        </div>
        <div class="review-stat">
          <div class="text-lg font-bold text-status-met">{{ metCount }}</div>
          <div class="card-stat-label">Reqs Met</div>
        </div>
        <div class="review-stat">
          <div class="text-lg font-bold text-status-info">{{ assessedCount }}/{{ REQUIREMENTS.length }}</div>
          <div class="card-stat-label">Assessed</div>
        </div>
        <div class="review-stat">
          <div class="text-sm font-bold text-status-experimental">{{ selectedUseCase?.name ?? '—' }}</div>
          <div class="card-stat-label">Use Case</div>
        </div>
      </div>
      <pre
        v-if="showExport"
        class="code-block overflow-x-auto max-h-80"
      >{{ exportJson }}</pre>
    </div>

    <!-- Bottom navigation bar -->
    <div class="flex items-center justify-between pt-1">
      <div class="flex items-center gap-3">
        <button
          v-if="step > 1"
          class="btn-outline"
          @click="step--"
        >&larr; Back</button>

        <template v-if="step === 3">
          <span class="text-help text-dim">Don't see your use case?</span>
          <a
            href="https://github.com/w3c/did-use-cases/issues"
            target="_blank"
            class="btn-accent"
          >Propose at W3C &#8599;</a>
        </template>
      </div>

      <div class="flex items-center gap-2">
        <button
          v-if="step === 2 && !methodName"
          class="btn-dashed"
          @click="fillDummy"
        >
          Use Demo Data
        </button>
        <button
        v-if="step < 6"
        :class="canAdvance()
          ? 'btn-primary'
          : 'btn-primary opacity-50 cursor-not-allowed'"
        :disabled="!canAdvance()"
        @click="canAdvance() && step++"
      >
        Next: {{ STEPS[step]?.label }} &rarr;
      </button>
      </div>
    </div>
  </div>

  <!-- Method quick-info modal -->
  <Teleport to="body">
    <div
      v-if="previewMethod"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="previewMethod = null"
    >
      <div class="preview-modal">
        <!-- Header -->
        <div class="preview-modal__header">
          <div>
            <h3 class="text-lg font-bold font-mono text-primary">{{ previewMethod.method }}</h3>
            <span class="tier-badge tier-badge--special">
              {{ REGISTRY_TYPES[previewMethod.registryType]?.label ?? previewMethod.registryType }}
            </span>
          </div>
          <button
            class="modal-header__close"
            @click="previewMethod = null"
          >&times;</button>
        </div>

        <!-- Body -->
        <div class="px-5 py-4 space-y-4">
          <!-- Purpose -->
          <p class="text-help text-dim border-l-2 border-blue-400/40 pl-3">
            Quick reference to evaluate whether this method's capabilities, industry focus, and requirement coverage align with your own specification needs.
          </p>

          <!-- Abstract -->
          <p v-if="previewMethod.abstract" class="text-description">
            {{ previewMethod.abstract }}
          </p>

          <!-- Key stats grid -->
          <div class="grid grid-cols-4 gap-2">
            <div class="mini-stat">
              <div class="text-sm font-bold text-status-info">{{ previewMethod.reqMet.length }}<span class="text-dim">/22</span></div>
              <div class="card-stat-label">Reqs Claimed</div>
            </div>
            <div class="mini-stat">
              <div class="text-sm font-bold text-secondary">{{ previewMethod.maturity.lifecycle }}</div>
              <div class="card-stat-label">Lifecycle</div>
            </div>
            <div class="mini-stat">
              <div class="text-sm font-bold text-secondary">{{ previewMethod.stars ?? '—' }}</div>
              <div class="card-stat-label">Stars</div>
            </div>
            <div class="mini-stat">
              <div class="text-sm font-bold text-secondary">{{ previewMethod.maturity.implementations ?? '—' }}</div>
              <div class="card-stat-label">Implementations</div>
            </div>
          </div>

          <!-- Industries -->
          <div>
            <h4 class="text-label font-semibold mb-1.5">Industries</h4>
            <div v-if="previewMethod.industries.length" class="flex flex-wrap gap-1">
              <span
                v-for="ind in previewMethod.industries"
                :key="ind"
                class="badge-industry"
                :class="previewIndustryColor(ind)"
              >{{ previewIndustryLabel(ind) }}</span>
            </div>
            <p v-else class="empty-state">Not yet provided by the method's assessment</p>
          </div>

          <!-- Use Case Fit -->
          <div>
            <h4 class="text-label font-semibold mb-1.5">Use Case Fit</h4>
            <template v-if="previewMethod.assessed">
              <div class="grid grid-cols-3 gap-1.5">
                <div v-for="(score, key) in previewMethod.ucScores" :key="key" class="score-cell">
                  <span class="text-xs text-description capitalize">{{ key }}</span>
                  <span v-if="score != null" class="text-xs font-mono" :class="score >= 70 ? 'text-status-met' : score >= 40 ? 'text-status-partial' : 'text-dim'">{{ score }}%</span>
                  <span v-else class="text-xs text-ghost">—</span>
                </div>
              </div>
            </template>
            <p v-else class="empty-state">Not yet provided by the method's assessment</p>
          </div>

          <!-- Features & Crypto — compact pill layout -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <h4 class="text-label font-semibold mb-1.5">Features</h4>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(val, key) in previewMethod.feat"
                  :key="key"
                  class="bool-pill"
                  :class="val === true
                    ? 'bool-pill--yes'
                    : val === false
                      ? 'bool-pill--no'
                      : 'bool-pill--unknown'"
                >{{ previewFeatureLabel(String(key)) }}</span>
              </div>
            </div>
            <div>
              <h4 class="text-label font-semibold mb-1.5">Crypto</h4>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(val, key) in previewMethod.crypto"
                  :key="key"
                  class="bool-pill"
                  :class="val === true
                    ? 'bool-pill--yes'
                    : val === false
                      ? 'bool-pill--no'
                      : 'bool-pill--unknown'"
                >{{ previewCryptoLabel(String(key)) }}</span>
              </div>
            </div>
          </div>

          <!-- Requirement overlap with current use case -->
          <div v-if="selectedUseCase && previewMethod.reqMet.length > 0">
            <h4 class="text-label font-semibold mb-1.5">
              Compatibility with "{{ selectedUseCase.name }}"
            </h4>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="reqId in selectedUseCase.requiredRequirements"
                :key="reqId"
                class="bool-pill font-mono"
                :class="previewMethod.reqMet.includes(reqId)
                  ? 'bool-pill--yes'
                  : 'bool-pill--unknown'"
              >{{ reqId }}</span>
            </div>
            <p class="text-[10px] text-dim mt-1">
              {{ selectedUseCase.requiredRequirements.filter(r => previewMethod!.reqMet.includes(r)).length }}
              of {{ selectedUseCase.requiredRequirements.length }} requirements covered
            </p>
          </div>

          <!-- Interoperability -->
          <div>
            <h4 class="text-label font-semibold mb-1.5">Interoperability</h4>
            <div v-if="previewMethod.compat.methods.length > 0" class="flex flex-wrap gap-1 items-center">
              <span
                v-for="m in previewMethod.compat.methods"
                :key="m"
                class="compat-badge"
              >{{ m }}</span>
              <span v-if="previewMethod.compat.via" class="text-[10px] text-dim ml-1">via {{ previewMethod.compat.via }}</span>
            </div>
            <p v-else class="empty-state">Not yet provided by the method's assessment</p>
          </div>

          <!-- Links -->
          <div class="flex gap-3 pt-1 border-t border-gray-700">
            <a
              v-if="previewMethod.specUrl"
              :href="previewMethod.specUrl"
              target="_blank"
              class="link"
            >Spec &#8599;</a>
            <a
              v-if="previewMethod.repoUrl"
              :href="previewMethod.repoUrl"
              target="_blank"
              class="link"
            >Repository &#8599;</a>
            <a
              v-if="repoZipUrl(previewMethod.repoUrl)"
              :href="repoZipUrl(previewMethod.repoUrl)!"
              class="link text-status-met"
              download
            >&#8681; Download ZIP</a>
            <span v-if="previewMethod.lastCommit" class="text-help text-dim ml-auto">
              Last activity: {{ previewMethod.lastCommit.slice(0, 10) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
