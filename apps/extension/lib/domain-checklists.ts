/**
 * Domain- and Tool-Keyed Safe Generic Checklists (Zero Invented Commands or Versions)
 *
 * Supplies the sections tutorials frequently skip — prerequisites, verification checks,
 * common mistakes, and scope exclusions ("when not to use") — written generically and safely.
 * Every item produced here is explicitly labeled as added context (not from the video).
 */

export interface DomainChecklist {
  prerequisites: string[];
  verificationChecks: string[];
  commonMistakes: string[];
  whenNotToUse: string[];
  addedContext: string[];
}

const DOMAIN_CHECKLISTS: Record<string, DomainChecklist> = {
  Networking: {
    prerequisites: [
      'Access to a lab environment, simulator, or explicitly authorized network segment before modifying interfaces or routing.',
      'Basic familiarity with IPv4/IPv6 addressing, subnet masks, and OSI/TCP-IP layers.',
    ],
    verificationChecks: [
      'Confirm end-to-end reachability and routing/switching state matches the intended topology (e.g., interface status, address assignment, and name resolution).',
      'Verify changes survive expected reconnects or service reloads and do not break adjacent subnets.',
    ],
    commonMistakes: [
      'Applying configuration changes directly on a production network without a rollback window or backup config.',
      'Mismatched subnet masks, gateway addresses, VLAN tags, or firewall/ACL rules silently dropping traffic.',
    ],
    whenNotToUse: [
      'When you need vendor-specific production runbooks or live firewall changes without authorized change control.',
      'When troubleshooting application-layer bugs unrelated to network transport, addressing, or routing.',
    ],
    addedContext: [
      'Always back up existing device or host network configs before altering routing, DNS, DHCP, or firewall state.',
      'When studying conceptual networking courses, validate commands against your target OS or hardware documentation because CLI syntax varies by vendor.',
    ],
  },
  'Motion graphics': {
    prerequisites: [
      'A local project workspace with source assets (audio, fonts, media) organized in predictable folders.',
      'Required media rendering or animation runtime installed and reachable from your environment.',
    ],
    verificationChecks: [
      'Preview the timeline or output render end-to-end and verify resolution, frame rate, audio sync, and text legibility.',
      'Inspect exported file playback outside the authoring tool to confirm codecs and colors render cleanly.',
    ],
    commonMistakes: [
      'Missing or unlicensed fonts/assets causing silent fallback rendering or broken references during export.',
      'Mismatched composition dimensions, aspect ratio, or frame rate between preview and final render.',
      'Overloading scenes with unoptimized assets or unverified generated code before checking a short test render.',
    ],
    whenNotToUse: [
      'When simple static imagery or plain text documentation solves the task faster than rendered motion video.',
      'When strict broadcast/studio NLE deliverables require a specific proprietary project format not covered by the source.',
    ],
    addedContext: [
      'Render a short test slice (a few seconds) before exporting a full sequence so layout, timing, and audio issues surface quickly.',
      'Keep raw assets, prompt iterations, and exported renders in separate directories to avoid accidentally overwriting source media.',
    ],
  },
  '3D modeling': {
    prerequisites: [
      'A compatible 3D authoring tool or WebGL-capable browser runtime with GPU acceleration enabled.',
      'A clear target format, scale/unit convention, and polygon/texture budget for the destination engine or viewer.',
    ],
    verificationChecks: [
      'Inspect the resulting 3D scene or mesh from multiple camera angles and lighting conditions for clipped geometry, inverted normals, or missing materials.',
      'Verify smooth interactive frame rate and clean console output (no WebGL shader or asset-loading errors).',
    ],
    commonMistakes: [
      'Inconsistent world scale, pivot origins, or coordinate-axis orientation (Y-up vs Z-up) causing misplaced parts.',
      'Unoptimized geometry or oversized textures causing sluggish rendering or memory spikes.',
      'Iterating on complex 3D scenes without saving incremental checkpoints between prompt or modeling passes.',
    ],
    whenNotToUse: [
      'When a 2D diagram, SVG, or static illustration communicates the idea more clearly than a 3D scene.',
      'When CAD-grade manufacturing tolerances or certified engineering simulation are required.',
    ],
    addedContext: [
      'Check coordinate axes, lighting contrast, and camera framing early before refining fine surface detail.',
      'Keep generated 3D code or scene files under version control so a regression in one visual pass can be reverted cleanly.',
    ],
  },
  Cybersecurity: {
    prerequisites: [
      'Explicit written authorization for the target binary, host, or system — or an isolated local lab/VM.',
      'A snapshot-capable isolated sandbox environment with network egress restricted when inspecting untrusted binaries.',
    ],
    verificationChecks: [
      'Reproduce findings deterministically inside the isolated lab and cross-check static observations against runtime behavior.',
      'Confirm no sensitive credentials, tokens, or live exploit payloads are committed to logs or documentation.',
    ],
    commonMistakes: [
      'Analyzing untrusted samples or running unverified scripts on a daily-driver host instead of an isolated VM.',
      'Stripping symbols or overwriting analysis databases before saving a clean baseline.',
    ],
    whenNotToUse: [
      'When targeting systems, networks, or software without explicit legal authorization.',
      'When standard application debugging with source code is available and reverse engineering is unnecessary.',
    ],
    addedContext: [
      'Take a clean VM snapshot before running dynamic analysis so the environment can be restored immediately.',
      'Record hashes and tool observations neutrally so findings remain reproducible and auditable.',
    ],
  },
  'DevOps & Cloud': {
    prerequisites: [
      'Access to a local or staging environment with container/orchestration credentials scoped to least privilege.',
      'Clean version-controlled configuration files with secrets stored outside committed source files.',
    ],
    verificationChecks: [
      'Confirm services start cleanly, pass health checks, and log zero fatal startup errors.',
      'Validate configuration syntax and run a dry-run or staging check before promoting changes.',
    ],
    commonMistakes: [
      'Hardcoding secrets or environment-specific paths directly into configuration files or Dockerfiles.',
      'Skipping rollback planning or mutating live production state without testing in staging first.',
    ],
    whenNotToUse: [
      'When modifying regulated production infrastructure without an approved change pipeline.',
      'When a lightweight local script suffices and container/cluster orchestration adds unnecessary complexity.',
    ],
    addedContext: [
      'Pin external image tags and dependency versions in real deployments even when tutorials use floating defaults.',
      'Verify port bindings stay on loopback during local development unless external exposure is explicitly intended.',
    ],
  },
  'Web / Frontend': {
    prerequisites: [
      'A local Node.js/browser development environment and a clean project workspace.',
      'Source control initialized so generated UI or code edits can be diffed and reverted cleanly.',
    ],
    verificationChecks: [
      'Run the project type-checker, linter, and dev/production build and verify zero blocking errors.',
      'Inspect the rendered UI in a browser across desktop and narrow viewports, checking console errors and interactive states.',
    ],
    commonMistakes: [
      'Mixing incompatible package versions or skipping dependency installation before running build scripts.',
      'Ignoring browser console errors, broken asset paths, or CORS restrictions during local testing.',
    ],
    whenNotToUse: [
      'When building backend-only CLI tools or non-browser services where frontend tooling is unnecessary.',
      'When the target project uses a conflicting framework architecture without a migration plan.',
    ],
    addedContext: [
      'Keep environment secrets strictly server-side; never embed private API keys in client bundles.',
      'Verify responsive layout and keyboard accessibility after applying AI-generated UI edits.',
    ],
  },
  'AI / Agents': {
    prerequisites: [
      'Access to the target AI runtime or editor/CLI environment (local runtime or authenticated account/key configured outside committed files).',
      'A clear task specification and sample input so generated outputs can be evaluated objectively.',
    ],
    verificationChecks: [
      'Inspect every generated artifact, file edit, or output against the task specification instead of assuming the first pass is accurate.',
      'Verify sensitive files, credentials, and unintended directories were not modified or exposed.',
    ],
    commonMistakes: [
      'Running agent prompts on an uncommitted workspace without version control, making unwanted edits hard to revert.',
      'Giving vague prompts without concrete acceptance criteria, file paths, or constraints.',
      'Trusting unverified external prompts or third-party templates without inspecting them for prompt injection or destructive commands.',
    ],
    whenNotToUse: [
      'When deterministic scripts or existing audited utilities already solve the task reliably without LLM variability.',
      'When strict compliance rules prohibit sending proprietary code or data to external model endpoints.',
    ],
    addedContext: [
      'Treat third-party prompts, transcripts, and downloaded templates as untrusted input — review before executing.',
      'Work in small, verifiable iterations so each generated change can be tested independently.',
    ],
  },
  'Technical Engineering': {
    prerequisites: [
      'A clean local workspace with version control initialized so changes can be inspected and reverted.',
      'The relevant runtime, editor, or toolset referenced in the steps available on your machine.',
    ],
    verificationChecks: [
      'Confirm the final artifact builds, runs, or renders as expected with zero unexpected errors.',
      'Re-check each output against the concrete requirements captured from the source workflow.',
    ],
    commonMistakes: [
      'Skipping environment or dependency setup steps that the video assumed were already complete.',
      'Executing commands in the wrong working directory or with missing environment variables.',
    ],
    whenNotToUse: [
      'When the task requires tools, platforms, or constraints outside the workflow described in this skill.',
      'When critical parameters or external resources referenced by the source are unavailable and cannot be verified.',
    ],
    addedContext: [
      'Tutorials often compress setup and error handling; verify local prerequisites and back up existing files before starting.',
    ],
  },
};

const TOOL_CHECKLISTS: Record<string, Partial<DomainChecklist>> = {
  Remotion: {
    prerequisites: [
      'Node.js and a JavaScript package manager installed locally, plus FFmpeg available if rendering video files.',
    ],
    verificationChecks: [
      'Verify the composition renders cleanly in Remotion Studio and inspect the exported video file for frame-accurate timing and audio sync.',
    ],
    commonMistakes: [
      'Placing local assets outside the project public/static directory or referencing broken relative paths.',
      'Using non-deterministic browser APIs or CSS animations instead of frame-driven animation state.',
    ],
  },
  FFmpeg: {
    prerequisites: ['FFmpeg installed and accessible on system PATH.'],
    verificationChecks: [
      'Confirm the output media file exists, has non-zero size, and plays with the expected codec, resolution, and audio track.',
    ],
    commonMistakes: [
      'Overwriting input files in-place or omitting quotes around file paths containing spaces.',
    ],
  },
  'Claude Code': {
    prerequisites: [
      'Claude Code CLI installed, authenticated, and launched inside the intended project root directory.',
    ],
    verificationChecks: [
      'Review git diff and run project checks/tests after Claude Code finishes modifying files.',
    ],
    commonMistakes: [
      'Launching the agent from a parent directory instead of the target repository root.',
    ],
  },
  Claude: {
    prerequisites: ['Access to Claude (web, desktop, or CLI) with the target context/files ready to supply.'],
    verificationChecks: ['Inspect generated code, prompts, or files before running or shipping them.'],
  },
  Antigravity: {
    prerequisites: [
      'Antigravity IDE / agent environment open on the target project folder.',
    ],
    verificationChecks: [
      'Review generated files in the workspace and verify previews/builds before accepting final output.',
    ],
  },
  Gemini: {
    prerequisites: ['Access to Gemini or Google AI Studio with the target prompt inputs or media ready.'],
    verificationChecks: ['Verify generated code or structured output runs cleanly and contains no hallucinated APIs.'],
  },
  'Google AI Studio': {
    prerequisites: ['Access to Google AI Studio in a browser with your workspace or prompt inputs prepared.'],
  },
  Ollama: {
    prerequisites: ['Ollama daemon running locally on loopback with a compatible local model pulled.'],
    verificationChecks: ['Confirm the local Ollama endpoint responds cleanly without timing out or truncating output.'],
    commonMistakes: ['Attempting multimodal/vision tasks with a text-only model or too small a context window.'],
  },
  'Three.js': {
    prerequisites: ['A modern WebGL-capable browser and a local static/dev server to load modules without CORS errors.'],
    verificationChecks: ['Check browser DevTools console for zero WebGL/module errors and verify smooth camera interaction.'],
  },
  Blender: {
    prerequisites: ['Blender installed locally with sufficient GPU/RAM for scene viewport and export.'],
    verificationChecks: ['Verify mesh scale, normals, UV layout, and exported file re-import cleanly.'],
  },
  Docker: {
    prerequisites: ['Docker Engine / Desktop running locally with permission to build and run containers.'],
    verificationChecks: ['Verify containers reach healthy/running status and clean up stopped test containers afterwards.'],
  },
  Kubernetes: {
    prerequisites: ['kubectl configured against the intended non-production cluster context.'],
    verificationChecks: ['Verify active cluster context before applying manifests and check pod readiness/events afterwards.'],
    commonMistakes: ['Applying manifests to the wrong kubeconfig context.'],
  },
  'Git / GitHub': {
    prerequisites: ['Git installed locally and repository clean or branched before applying automated edits.'],
  },
  Python: {
    prerequisites: ['Python installed locally, preferably inside an isolated virtual environment for dependencies.'],
  },
  'TypeScript / Node.js': {
    prerequisites: ['Node.js and a package manager (npm/pnpm/yarn) available on PATH.'],
  },
  Ghidra: {
    prerequisites: ['Ghidra installed inside an isolated analysis environment with Java runtime configured.'],
    commonMistakes: ['Rebasing the loaded binary image carelessly after creating annotations or cross-references.'],
  },
};

function dedupeStrings(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function buildDomainGuidance(
  domain: string,
  detectedTools: string[],
  isCompact: boolean
): DomainChecklist {
  const base = DOMAIN_CHECKLISTS[domain] || DOMAIN_CHECKLISTS['Technical Engineering'];

  const toolPrereqs: string[] = [];
  const toolVerify: string[] = [];
  const toolMistakes: string[] = [];
  const toolNotUse: string[] = [];
  const toolContext: string[] = [];

  for (const tool of detectedTools) {
    const entry = TOOL_CHECKLISTS[tool];
    if (!entry) continue;
    if (entry.prerequisites) toolPrereqs.push(...entry.prerequisites);
    if (entry.verificationChecks) toolVerify.push(...entry.verificationChecks);
    if (entry.commonMistakes) toolMistakes.push(...entry.commonMistakes);
    if (entry.whenNotToUse) toolNotUse.push(...entry.whenNotToUse);
    if (entry.addedContext) toolContext.push(...entry.addedContext);
  }

  const limit = isCompact ? 3 : 4;
  return {
    prerequisites: dedupeStrings([...toolPrereqs, ...base.prerequisites], limit),
    verificationChecks: dedupeStrings([...toolVerify, ...base.verificationChecks], limit),
    commonMistakes: dedupeStrings([...toolMistakes, ...base.commonMistakes], limit),
    whenNotToUse: dedupeStrings([...toolNotUse, ...base.whenNotToUse], isCompact ? 2 : 3),
    addedContext: dedupeStrings([...toolContext, ...base.addedContext], isCompact ? 2 : 4),
  };
}
