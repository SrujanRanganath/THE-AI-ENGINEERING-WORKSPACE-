export interface GuidedTourStep {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  route: string;
  targetSelector: string;
  highlights: string[];
}

export const GUIDED_TOUR_STEPS: GuidedTourStep[] = [
  {
    id: 'dashboard',
    stepNumber: 1,
    title: 'Workspace Command Center',
    description:
      'Your Engineering Workspace brings all four intelligent AI agents together with live saved project counts and quick access to Recent Work.',
    route: '/dashboard',
    targetSelector: '[data-tour="dashboard-agents"]',
    highlights: [
      '2×2 launch grid across Code, Website, Data & Document studios',
      'Real-time saved project counts per agent (no placeholder metrics)',
    ],
  },
  {
    id: 'code-generator',
    stepNumber: 2,
    title: '01 · AI Code Generator',
    description:
      'Architect complete multi-file codebases with a built-in explorer, side-by-side modification diffs, immutable version history, and ZIP download.',
    route: '/code-generator',
    targetSelector: '[data-tour="code-studio-panel"]',
    highlights: [
      'Language, framework & database blueprint configuration',
      'Version snapshots & path-sanitized ZIP export',
    ],
  },
  {
    id: 'website-generator',
    stepNumber: 3,
    title: '02 · AI Website Builder',
    description:
      'Synthesize full React/Vite or HTML/CSS sites using Hydrogen, edit source files directly, inspect compiler diagnostics, and publish persistent shareable previews.',
    route: '/website-generator',
    targetSelector: '[data-tour="website-studio-panel"]',
    highlights: [
      'Sandboxed live preview with Desktop / Tablet / Mobile viewports',
      'Durable Publish Preview URLs surviving reloads & new browser tabs',
    ],
  },
  {
    id: 'document-generator',
    stepNumber: 4,
    title: '03 · AI Document Generator',
    description:
      'Generate structured reports, proposals, and research papers from a single prompt, edit live Markdown, and export native OpenXML .docx files.',
    route: '/document-generator',
    targetSelector: '[data-tour="document-studio-panel"]',
    highlights: [
      'Prompt-driven structure with headings, tables, and lists',
      'Native OpenXML Word (.docx) binary generation',
    ],
  },
  {
    id: 'data-cleaner',
    stepNumber: 5,
    title: '04 · AI Data Cleaner',
    description:
      'Inspect CSV or XLSX files with real statistical profiling, execute natural-language cleaning instructions safely, and export verified sheets.',
    route: '/data-cleaner',
    targetSelector: '[data-tour="data-cleaner-panel"]',
    highlights: [
      'Original dataset stays strictly preserved for Before/After review',
      'Schema-validated plain-English transforms & CSV/XLSX downloads',
    ],
  },
  {
    id: 'projects',
    stepNumber: 6,
    title: 'My Projects Repository',
    description:
      'Manage all your saved codebases, websites, documents, and cleaned datasets in one unified, searchable, owner-scoped repository.',
    route: '/projects',
    targetSelector: '[data-tour="projects-repository"]',
    highlights: [
      'Filter by agent studio, search by title, rename, export, or delete',
    ],
  },
  {
    id: 'activity',
    stepNumber: 7,
    title: 'Recent Activity Stream',
    description:
      'Review a chronological audit log of generations, source modifications, published previews, and dataset cleaning pipelines.',
    route: '/activity',
    targetSelector: '[data-tour="activity-stream"]',
    highlights: ['Filter activity by agent type with timestamped audit entries'],
  },
  {
    id: 'settings',
    stepNumber: 8,
    title: 'Workspace & Account Settings',
    description:
      'Update your engineer profile, inspect connected Firebase and server proxy health, or restart onboarding preferences anytime.',
    route: '/settings',
    targetSelector: '[data-tour="settings-overview"]',
    highlights: ['Owner-scoped Firebase config & Guided Tour controls'],
  },
  {
    id: 'help',
    stepNumber: 9,
    title: 'Help & Guided Tour',
    description:
      'Explore workflow documentation, preview compiler capabilities, security details, or replay this 9-step Guided Tour whenever you need.',
    route: '/help',
    targetSelector: '[data-tour="help-documentation"]',
    highlights: [
      'Compiler & sandbox security boundary reference',
      'One-click Guided Tour restart available from Help or Sidebar',
    ],
  },
];
