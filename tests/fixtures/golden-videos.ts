/**
 * Golden Test Fixtures for SkillLoom Distiller & Quality Gate
 *
 * Covers all four size profiles:
 * 1. LONG   — Full multi-chapter technical course (YouTube, > 12 min, chapters, ASR typos, sponsor)
 * 2. MEDIUM — Practical multi-tool workflow tutorial (YouTube, ~8 min, negation, pinned links, pitfalls)
 * 3. SHORT  — Rapid 3-minute AI/3D demo (YouTube, ~3 min, visual blindspots, minimal captions)
 * 4. REEL   — Instagram Reel (no subtitles, DM-bait title, caption + hashtags + comments + keyframes)
 */

import type { BrowserVideoInput } from '../../apps/extension/lib/browser-skill-builder';

const FAKE_JPG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64');

export const GOLDEN_LONG_NETWORKING: BrowserVideoInput = {
  sourcePlatform: 'youtube',
  videoId: 'golden-long-net01',
  title: 'Computer Networking Course - Network Engineering [CompTIA Network+ Exam Prep]',
  channelName: 'freeCodeCamp.org',
  durationSeconds: 14100,
  pageUrl: 'https://www.youtube.com/watch?v=golden-long-net01',
  description: [
    'Full CompTIA Network+ engineering course covering OSI layers, DHCP, DNS, NAT, subnetting, and fiber cabling.',
    '00:00 Intro to Network Devices',
    '28:36 DHCP Configuration & Address Pools',
    '44:23 DNS Resolution & Dynamic DNS',
    '52:10 Network Address Translation (NAT)',
    '01:01:06 Cabling, Fiber & Ethernet Standards',
    '02:04:33 IPv4 Subnetting & CIDR Masks',
    'Reference docs: https://www.comptia.org/certifications/network',
    '…afficher plus 931 abonnés Transcription Suivez la vidéo à l’aide de la transcription',
  ].join('\n'),
  labeledLinks: [
    { label: 'CompTIA Network+ Objectives', url: 'https://www.comptia.org/certifications/network', source: 'description' },
  ],
  chapters: [
    { title: 'Intro to Network Devices', startSeconds: 0 },
    { title: 'DHCP Configuration & Address Pools', startSeconds: 1716 },
    { title: 'DNS Resolution & Dynamic DNS', startSeconds: 2663 },
    { title: 'Network Address Translation (NAT)', startSeconds: 3130 },
    { title: 'Cabling, Fiber & Ethernet Standards', startSeconds: 3666 },
    { title: 'IPv4 Subnetting & CIDR Masks', startSeconds: 7473 },
  ],
  transcriptSegments: [
    { startSeconds: 5, timestampLabel: '00:05', text: 'Hey everyone, welcome back to the channel! Give me a second and hit subscribe.' },
    { startSeconds: 37, timestampLabel: '00:37', text: 'First, map every hub, switch, and router to its highest layer in the OSI model to prepare for Comp Tia\'s network plus exam.' },
    { startSeconds: 95, timestampLabel: '01:35', text: 'Use a Layer 2 switch to isolate collision domains using MAC address tables.' },
    { startSeconds: 120, timestampLabel: '02:00', text: 'This video is sponsored by NordVPN. Use code NETPLUS for 60% off your first plan.' },
    { startSeconds: 150, timestampLabel: '02:30', text: 'Check out their link in the description below for a great deal.' },
    { startSeconds: 1730, timestampLabel: '28:50', text: 'Configure a DHCP scope with a start IP, end IP, subnet mask, default gateway, and lease duration.' },
    { startSeconds: 1790, timestampLabel: '29:50', text: 'Create DHCP reservations by binding a host MAC address to a fixed IPv4 address for printers and servers.' },
    { startSeconds: 1850, timestampLabel: '30:50', text: 'Run ipconfig /all on Windows to inspect the assigned DHCP lease, gateway, and DNS server.' },
    { startSeconds: 2675, timestampLabel: '44:35', text: 'Configure forward lookup A and AAAA records alongside reverse PTR records on your DNS server.' },
    { startSeconds: 2740, timestampLabel: '45:40', text: 'Verify name resolution using nslookup example.com or dig example.com and confirm the returned FQ dn matches.' },
    { startSeconds: 3150, timestampLabel: '52:30', text: 'Configure PAT overload on the border router so multiple private 192.168.1.0/24 hosts share one public IPv4 address.' },
    { startSeconds: 3220, timestampLabel: '53:40', text: 'Never expose internal management ports through static NAT without restricting source IPs on the firewall.' },
    { startSeconds: 3690, timestampLabel: '01:01:30', text: 'Select Cat five, he or Cat six a twisted-pair cabling for 1Gbps to 10 gb E copper runs up to 100 meters.' },
    { startSeconds: 3760, timestampLabel: '01:02:40', text: 'Use single-mode fiber with laser diodes for long-haul links and multimode fiber for short campus backbones.' },
    { startSeconds: 7490, timestampLabel: '02:04:50', text: 'Calculate host capacity for a /24 subnet (255 dot 255 dot 255 dot 0) as 254 usable host addresses.' },
    { startSeconds: 7560, timestampLabel: '02:06:00', text: 'Verify subnet routing with ping 192.168.1.1 and traceroute 8.8.8.8 across hops.' },
    { startSeconds: 7620, timestampLabel: '02:07:00', text: 'Thanks so much for watching and don\'t forget to like and subscribe!' },
  ],
};

export const GOLDEN_MEDIUM_MOTION: BrowserVideoInput = {
  sourcePlatform: 'youtube',
  videoId: 'golden-med-motion01',
  title: 'Gemini Skills: I Rebuilt Any Motion Graphic in My Own Style (No After Effects)',
  channelName: 'Tool Drop',
  durationSeconds: 516,
  pageUrl: 'https://www.youtube.com/watch?v=golden-med-motion01',
  description: [
    'Rebuild any reference motion graphic in your own brand style with Gemini, anti-gravity, and Remotion — no After Effects required.',
    '00:17 Decode Any Motion Graphic With Gemini',
    '01:53 Add Your Brand and Build the Gemini Skill',
    '03:33 Plan the Animation Before Building',
    '05:10 Render in Remotion Studio',
    'Tools: https://aistudio.google.com and https://www.remotion.dev',
    'Related videos: Watch my Claude Code video next!',
    '#MotionGraphics #GoogleGemini #Antigravity #Remotion',
  ].join('\n'),
  pinnedComment: {
    author: '@ToolDrop',
    isCreator: true,
    text: [
      'Decoding prompt: https://drive.google.com/file/d/example-decode/view',
      'Brand template (.md): https://drive.google.com/file/d/example-brand/view',
      'Make sure not to drag-and-drop raw .md files directly into Gemini Gems — upload via the file picker if Gemini says file type unavailable.',
    ].join('\n'),
  },
  labeledLinks: [
    { label: 'Remotion Docs', url: 'https://www.remotion.dev/docs', source: 'description' },
    { label: 'Decoding Prompt', url: 'https://drive.google.com/file/d/example-decode/view', source: 'pinned_comment' },
  ],
  chapters: [
    { title: 'Decode Any Motion Graphic With Gemini', startSeconds: 17 },
    { title: 'Add Your Brand and Build the Gemini Skill', startSeconds: 113 },
    { title: 'Plan the Animation Before Building', startSeconds: 213 },
    { title: 'Render in Remotion Studio', startSeconds: 310 },
  ],
  transcriptSegments: [
    { startSeconds: 3, timestampLabel: '00:03', text: 'Hey guys, welcome back! Today you do not need After Effects to build crisp motion graphics.' },
    { startSeconds: 18, timestampLabel: '00:18', text: 'First, open Gemini, click the model menu, and select Gemini 2.5 Pro for multimodal video decoding.' },
    { startSeconds: 50, timestampLabel: '00:50', text: 'Upload the reference motion clip, copy the decoding prompt from the pinned comment, paste it, and send.' },
    { startSeconds: 77, timestampLabel: '01:17', text: 'Say: "Turn this into a markdown file" and export the style specification as style-spec.md.' },
    { startSeconds: 120, timestampLabel: '02:00', text: 'Open a new chat in Gemini and upload style-spec.md alongside your brand.md palette and typography rules.' },
    { startSeconds: 139, timestampLabel: '02:19', text: 'When I dragged and dropped the file, Gemini said the file type was unavailable, so use the upload button instead.' },
    { startSeconds: 156, timestampLabel: '02:36', text: 'Paste the recreate request prompt so Gemini outputs one exact build prompt for anti-gravity.' },
    { startSeconds: 245, timestampLabel: '04:05', text: 'Always plan the animation before generating code because Antigravity has a weekly limit on the free tier.' },
    { startSeconds: 315, timestampLabel: '05:15', text: 'Run npm install and npx remotion studio in your project directory to preview at 60fps.' },
    { startSeconds: 360, timestampLabel: '06:00', text: 'Export the final 1080x1920 video with npx remotion render src/index.ts Main out/final.mp4.' },
    { startSeconds: 490, timestampLabel: '08:10', text: 'Watch my Claude Code video next and don\'t forget to subscribe!' },
  ],
};

export const GOLDEN_SHORT_3D: BrowserVideoInput = {
  sourcePlatform: 'youtube',
  videoId: 'golden-short-3d01',
  title: 'FREE Gemini 4 Hydrogen Made This 3D Animation in 2 Messages',
  channelName: 'Tested for Creators',
  durationSeconds: 198,
  pageUrl: 'https://www.youtube.com/watch?v=golden-short-3d01',
  description: 'Build an interactive Three.js 3D scene for free in Google AI Studio.\nhttps://aistudio.google.com',
  labeledLinks: [
    { label: 'Google AI Studio', url: 'https://aistudio.google.com', source: 'description' },
  ],
  chapters: [],
  transcriptSegments: [
    { startSeconds: 0, timestampLabel: '00:00', text: 'Look at this! Gemini 4 Hydrogen just built this interactive 3D animation in two messages.' },
    { startSeconds: 27, timestampLabel: '00:27', text: 'Step one: open Google AI Studio, sign in, and select the Gemini 4 Hydrogen model.' },
    { startSeconds: 58, timestampLabel: '00:58', text: 'Prompt it to generate a single-file HTML Three.js 3D scene sized for a vertical 1080x1920 frame.' },
    { startSeconds: 71, timestampLabel: '01:11', text: 'Three minutes later, look at this lighting glitch on the screen — send one follow-up fix prompt specifying key light contrast and camera orbit speed.' },
    { startSeconds: 144, timestampLabel: '02:24', text: 'Save the output as index.html and open it in Chrome on desktop to verify 60fps WebGL rendering.' },
  ],
};

export const GOLDEN_REEL_EDITOR: BrowserVideoInput = {
  sourcePlatform: 'instagram',
  videoId: 'ig-golden-reel01',
  title: 'Comment "EDITOR" and I’ll send you the prompt that turns Claude into your own video editor👇',
  channelName: '@alex.motion',
  durationSeconds: 64,
  pageUrl: 'https://www.instagram.com/reel/ig-golden-reel01/',
  description: [
    'Comment “EDITOR” and I’ll send you the prompt that turns Claude into your own video editor👇',
    'Most AI edits look like slop because the AI has tools but no taste.',
    'The 2 libraries most people skip: real sound effects (clicks, typing, swooshes) + 200+ motion graphics with the prompts behind them.',
    'Feed Claude 5 to 10 of your own edited videos so it learns your pacing and style rules.',
    'Want the prompt + step by step guide? Comment "EDITOR" and it’s yours.',
    '#claudeai #videoediting #remotion #motiongraphics',
  ].join('\n'),
  pinnedComment: {
    author: '@alex.motion',
    isCreator: true,
    text: 'Starter structure uses Remotion with public/sfx/ audio assets and a style-rules.md file. Docs: https://www.remotion.dev',
  },
  labeledLinks: [
    { label: 'Remotion', url: 'https://www.remotion.dev', source: 'pinned_comment' },
  ],
  capturedFrames: [
    {
      id: 'rf-1',
      timestampSeconds: 4,
      timestampLabel: '00:04',
      dataUrl: `data:image/jpeg;base64,${FAKE_JPG_B64}`,
      note: 'Folder structure: public/sfx + prompts/',
      source: 'video_canvas',
      contentScore: 76,
      contentKind: 'code-or-ui',
    },
    {
      id: 'rf-2',
      timestampSeconds: 22,
      timestampLabel: '00:22',
      dataUrl: `data:image/jpeg;base64,${FAKE_JPG_B64}`,
      note: 'Claude project style-rules.md settings',
      source: 'video_canvas',
      contentScore: 82,
      contentKind: 'code-or-ui',
    },
    {
      id: 'rf-3',
      timestampSeconds: 44,
      timestampLabel: '00:44',
      dataUrl: `data:image/jpeg;base64,${FAKE_JPG_B64}`,
      source: 'video_canvas',
      contentScore: 22,
      contentKind: 'visual-scene',
    },
  ],
  transcriptSegments: [],
};
