> Historical design: the static site is implemented. See ../../README.md for current usage.

# Static Site Generation + Experiential Wiki Interface

## Vision

Transform Ted Mosby's markdown wiki output into an **interactive, conversational documentation experience**. Instead of static pages, users get a "magical onboarding" where they can explore architecture through guided conversations, interactive diagrams, and progressive disclosure.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Ted Mosby CLI                                │
│  (existing: generates markdown wiki with source traceability)       │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    NEW: Static Site Generator                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Markdown     │  │ Mermaid      │  │ Conversation Index       │  │
│  │ → HTML       │  │ → SVG/Canvas │  │ Builder                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Generated Static Site                             │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Experiential Layer                                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │ │
│  │  │ Guide Mode  │ │ Interactive │ │ Conversational          │   │ │
│  │  │ (Onboarding)│ │ Diagrams    │ │ Search                  │   │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘   │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │ │
│  │  │ Code        │ │ Learning    │ │ Architecture            │   │ │
│  │  │ Spotlight   │ │ Paths       │ │ Explorer                │   │ │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Traditional Wiki Pages (enhanced markdown → HTML)              │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Static Site Generator Core

### 1.1 New Module Structure

```
src/
├── site-generator/
│   ├── index.ts              # Main generator orchestrator
│   ├── markdown-renderer.ts  # MD → HTML with enhancements
│   ├── mermaid-renderer.ts   # Mermaid → SVG pre-rendering
│   ├── template-engine.ts    # HTML templates & layouts
│   ├── asset-pipeline.ts     # CSS/JS bundling
│   └── search-index.ts       # Build search index for wiki
├── templates/
│   ├── base.html             # Base layout
│   ├── wiki-page.html        # Standard wiki page
│   ├── guide-mode.html       # Onboarding experience
│   └── components/           # Reusable HTML components
└── site-assets/
    ├── css/
    │   ├── main.css          # Core styles
    │   ├── code-theme.css    # Syntax highlighting
    │   └── animations.css    # Transition effects
    └── js/
        ├── guide.js          # Guide mode logic
        ├── diagrams.js       # Interactive diagram handling
        ├── search.js         # Client-side search
        └── conversation.js   # Conversational interface
```

### 1.2 CLI Extension

Add new command to `cli.ts`:

```typescript
program
  .command('build')
  .description('Build static site from generated wiki')
  .option('-i, --input <path>', 'Wiki directory', './wiki')
  .option('-o, --output <path>', 'Output directory', './site')
  .option('--guide', 'Enable guide/onboarding mode', true)
  .option('--interactive', 'Enable interactive diagrams', true)
  .option('--conversation', 'Enable conversational search', true)
  .option('--theme <name>', 'Visual theme', 'default')
  .action(buildSite);
```

### 1.3 Markdown Renderer Enhancements

- **Source traceability links**: Convert `file:line` references to highlighted, clickable links
- **Code blocks**: Syntax highlighting with copy button, line numbers
- **Mermaid pre-rendering**: Convert to SVG at build time (no JS dependency for basic view)
- **Auto-linking**: Smart cross-page reference detection
- **Frontmatter extraction**: Use metadata for navigation, search, categorization

---

## Phase 2: Experiential Layer - "Magical Onboarding"

### 2.1 Guide Mode (Primary Experience)

A conversational, progressive tour through the architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│  🏛️ Welcome to [Project Name]                                   │
│                                                                  │
│  I'm your architecture guide. Let's explore this codebase       │
│  together. What would you like to understand?                   │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ 🎯 Quick Tour   │  │ 🔍 Find Feature │  │ 🏗️ Deep Dive    │  │
│  │ (5 min)         │  │                 │  │ Architecture    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  Or ask me anything: [________________________] [Ask]           │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Persona-based guidance**: The wiki "speaks" as a knowledgeable guide
- **Progressive disclosure**: Start high-level, drill down on interest
- **Contextual suggestions**: "Now that you understand X, you might want to explore Y"
- **Breadcrumb trail**: Visual path of exploration journey

### 2.2 Interactive Architecture Diagrams

Transform static Mermaid diagrams into explorable interfaces:

```
┌─────────────────────────────────────────────────────────────────┐
│  System Architecture                                    [Expand] │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                              ││
│  │    ┌──────────┐      ┌──────────┐      ┌──────────┐        ││
│  │    │  Client  │─────▶│   API    │─────▶│ Database │        ││
│  │    │  ◉ hover │      │  Layer   │      │          │        ││
│  │    └──────────┘      └──────────┘      └──────────┘        ││
│  │         │                                                   ││
│  │         ▼                                                   ││
│  │  ┌────────────────────────────────────────────────────────┐ ││
│  │  │ Client Module                                          │ ││
│  │  │ Handles user interface and state management            │ ││
│  │  │                                                        │ ││
│  │  │ Key files:                                             │ ││
│  │  │ • src/client/index.ts:1-45                            │ ││
│  │  │ • src/client/state.ts:12-89                           │ ││
│  │  │                                                        │ ││
│  │  │ [View Documentation] [Explore Code]                    │ ││
│  │  └────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Interactions:**
- **Hover**: Show component summary
- **Click**: Expand to full details with code references
- **Zoom**: Focus on subsystem
- **Pan**: Navigate large diagrams
- **Filter**: Show/hide by component type

### 2.3 Conversational Search Interface

Natural language search that feels like talking to someone who knows the codebase:

```
┌─────────────────────────────────────────────────────────────────┐
│  💬 Ask about the architecture                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ User: How does authentication work?                         ││
│  │                                                              ││
│  │ Guide: Authentication in this project uses JWT tokens.      ││
│  │ Here's the flow:                                            ││
│  │                                                              ││
│  │ 1. User submits credentials → src/auth/login.ts:23          ││
│  │ 2. Server validates → src/auth/validate.ts:45               ││
│  │ 3. JWT generated → src/auth/jwt.ts:12                       ││
│  │                                                              ││
│  │ [View full auth documentation] [Show diagram]               ││
│  │                                                              ││
│  │ Related questions:                                          ││
│  │ • How are tokens refreshed?                                 ││
│  │ • What permissions system is used?                          ││
│  └─────────────────────────────────────────────────────────────┘│
│  [_______________________] [Ask]                                │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation Options:**
1. **Static (Build-time)**: Pre-compute common Q&A pairs, use client-side fuzzy search
2. **Hybrid**: Static index + optional API endpoint for live Claude queries
3. **Full AI**: Embed conversation widget that calls Claude API (requires user's key)

### 2.4 Code Spotlight

When viewing code references, provide rich context:

```
┌─────────────────────────────────────────────────────────────────┐
│  📍 src/auth/jwt.ts:12-45                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  12 │ export class JwtProvider {                            ││
│  │  13 │   private secret: string;                             ││
│  │  14 │                                                       ││
│  │  15 │   async generateToken(user: User): Promise<string> {  ││
│  │  16 │     return jwt.sign(                                  ││
│  │  ...│     ...                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  📖 This code...                                                │
│  • Generates JWT tokens for authenticated users                 │
│  • Called by: src/auth/login.ts:67, src/api/refresh.ts:23      │
│  • Calls: jsonwebtoken library, src/config/secrets.ts          │
│                                                                  │
│  [← Back to Auth Flow] [View Full File] [Copy Code]            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.5 Learning Paths

Pre-defined journeys through the documentation:

```
┌─────────────────────────────────────────────────────────────────┐
│  🎓 Learning Paths                                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🚀 New Developer Onboarding                    [Start]      ││
│  │ Get up to speed with the codebase in 30 minutes            ││
│  │ Progress: ████████░░░░░░░░ 45%                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔒 Security Deep-Dive                          [Start]      ││
│  │ Understand auth, permissions, and data protection          ││
│  │ Progress: Not started                                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🗄️ Data Layer Mastery                          [Start]      ││
│  │ Database schema, ORM patterns, migrations                   ││
│  │ Progress: Not started                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 3: Build Pipeline

### 3.1 Generation Flow

```typescript
// src/site-generator/index.ts

export interface SiteGeneratorOptions {
  input: string;           // Wiki directory
  output: string;          // Output directory
  enableGuide: boolean;    // Guide mode
  enableInteractive: boolean; // Interactive diagrams
  enableConversation: boolean; // Chat interface
  theme: string;           // Visual theme
  baseUrl?: string;        // For absolute URLs
}

export async function* generateSite(options: SiteGeneratorOptions): AsyncGenerator<BuildEvent> {
  // 1. Discover wiki content
  yield { phase: 'discovery', message: 'Scanning wiki content...' };
  const pages = await discoverWikiPages(options.input);

  // 2. Build navigation structure
  yield { phase: 'structure', message: 'Building navigation...' };
  const navigation = buildNavigationTree(pages);

  // 3. Build search index
  yield { phase: 'search', message: 'Indexing for search...' };
  const searchIndex = await buildSearchIndex(pages);

  // 4. Pre-render Mermaid diagrams
  yield { phase: 'diagrams', message: 'Rendering diagrams...' };
  const diagrams = await renderMermaidDiagrams(pages);

  // 5. Generate conversation index (for AI-like responses)
  if (options.enableConversation) {
    yield { phase: 'conversation', message: 'Building conversation index...' };
    await buildConversationIndex(pages);
  }

  // 6. Generate HTML pages
  for (const page of pages) {
    yield { phase: 'render', message: `Rendering ${page.path}...` };
    await renderPage(page, { navigation, diagrams, options });
  }

  // 7. Generate guide mode assets
  if (options.enableGuide) {
    yield { phase: 'guide', message: 'Creating guide experience...' };
    await generateGuideMode(pages, navigation);
  }

  // 8. Bundle assets
  yield { phase: 'assets', message: 'Bundling CSS/JS...' };
  await bundleAssets(options);

  // 9. Generate service worker (for offline support)
  yield { phase: 'pwa', message: 'Creating offline support...' };
  await generateServiceWorker(options.output);

  yield { phase: 'complete', message: 'Site generation complete!' };
}
```

### 3.2 Conversation Index Structure

Pre-compute Q&A pairs at build time for static conversational experience:

```typescript
interface ConversationIndex {
  // Extracted from wiki content
  concepts: Array<{
    term: string;
    definition: string;
    sourceRefs: string[];
    relatedConcepts: string[];
  }>;

  // Generated Q&A pairs
  qaIndex: Array<{
    question: string;       // "How does X work?"
    answer: string;         // Summary from wiki
    sourcePages: string[];  // Links to full docs
    codeRefs: string[];     // Direct code links
  }>;

  // For fuzzy matching
  embeddings: {
    questions: number[][];  // Vector embeddings
    concepts: number[][];
  };
}
```

---

## Phase 4: Enhanced Wiki Generation

### 4.1 New System Prompt Additions

Add to `wiki-system.ts` for richer metadata:

```typescript
// Additional generation requirements for experiential features

EXPERIENTIAL_REQUIREMENTS: `
For each wiki page, also generate:

1. **Summary Block** (YAML frontmatter)
   - one_liner: Single sentence description
   - key_concepts: List of 3-5 main concepts
   - prerequisites: What to understand first
   - next_steps: Suggested pages after this

2. **Guided Questions**
   At the end of each major section, suggest questions a reader might have:
   \`\`\`yaml
   guided_questions:
     - "How does this connect to [related concept]?"
     - "What happens when [edge case]?"
   \`\`\`

3. **Learning Objectives**
   For each page:
   \`\`\`yaml
   learning_objectives:
     - "Understand how [X] handles [Y]"
     - "Know when to use [pattern]"
   \`\`\`

4. **Concept Relationships**
   Tag relationships for interactive diagrams:
   \`\`\`yaml
   relationships:
     - { from: "AuthService", to: "JwtProvider", type: "uses" }
     - { from: "AuthService", to: "UserRepository", type: "depends_on" }
   \`\`\`
`
```

### 4.2 New MCP Tools for Site Generation

```typescript
// Additional tools for the wiki agent

tools: [
  {
    name: 'define_learning_path',
    description: 'Define a guided learning path through documentation',
    parameters: {
      name: 'string',
      description: 'string',
      steps: 'array of { page, objective, estimatedMinutes }'
    }
  },
  {
    name: 'add_guided_question',
    description: 'Add an interactive question to a wiki section',
    parameters: {
      page: 'string',
      section: 'string',
      question: 'string',
      hints: 'array of string'
    }
  },
  {
    name: 'create_concept_map',
    description: 'Generate a concept relationship map for a topic',
    parameters: {
      topic: 'string',
      concepts: 'array of { name, description, relates_to }'
    }
  }
]
```

---

## Phase 5: Themes & Customization

### 5.1 Theme System

```
site-assets/themes/
├── default/
│   ├── variables.css    # CSS custom properties
│   ├── components.css   # Component styles
│   └── guide.css        # Guide mode styles
├── dark/
│   └── ...
├── minimal/
│   └── ...
└── corporate/
    └── ...
```

### 5.2 Configuration

```typescript
// wiki.config.json (project-level customization)
{
  "site": {
    "title": "My Project Docs",
    "logo": "./assets/logo.svg",
    "theme": "default",
    "features": {
      "guideMode": true,
      "interactiveDiagrams": true,
      "conversationalSearch": true,
      "learningPaths": true,
      "codeSpotlight": true
    },
    "conversation": {
      "mode": "static",  // or "hybrid" or "live"
      "apiEndpoint": null  // for hybrid/live modes
    }
  }
}
```

---

## Implementation Order

### Sprint 1: Core Static Site Generator
1. Create `src/site-generator/` module structure
2. Implement markdown → HTML renderer with syntax highlighting
3. Build template engine with base layouts
4. Add Mermaid → SVG pre-rendering
5. Implement CLI `build` command
6. Basic CSS styling

### Sprint 2: Search & Navigation
1. Build search index generator
2. Implement client-side fuzzy search
3. Create navigation tree builder
4. Add breadcrumb system
5. Implement cross-page linking

### Sprint 3: Guide Mode Experience
1. Design guide mode UI/UX
2. Implement progressive disclosure system
3. Create onboarding flow templates
4. Add contextual suggestions engine
5. Build journey tracking (localStorage)

### Sprint 4: Interactive Diagrams
1. Create diagram interaction layer
2. Implement hover/click behaviors
3. Add zoom/pan for large diagrams
4. Link diagram nodes to documentation
5. Build component detail overlays

### Sprint 5: Conversational Interface
1. Build conversation index at build time
2. Implement static Q&A matching
3. Create chat UI component
4. Add related questions suggestions
5. Optional: API integration for live Claude queries

### Sprint 6: Polish & Extras
1. Learning paths system
2. Code spotlight feature
3. Offline support (PWA)
4. Multiple themes
5. Performance optimization
6. Documentation for the documentation system

---

## Technical Dependencies to Add

```json
{
  "dependencies": {
    "marked": "^12.0.0",           // Markdown parsing
    "shiki": "^1.0.0",             // Syntax highlighting
    "mermaid": "^10.6.0",          // Diagram rendering
    "puppeteer-core": "^22.0.0",   // Mermaid → SVG
    "fuse.js": "^7.0.0",           // Fuzzy search
    "ejs": "^3.1.9",               // HTML templating
    "esbuild": "^0.20.0",          // JS bundling
    "lightningcss": "^1.23.0"      // CSS processing
  }
}
```

---

## Success Metrics

1. **Time to Understanding**: New developer can grasp architecture in <30 min
2. **Engagement**: Users explore 5+ pages per session (vs 2 for static docs)
3. **Search Success**: 80% of searches lead to relevant content
4. **Guide Completion**: 60% of users complete onboarding path
5. **Return Visits**: Documentation becomes reference, not one-time read

---

## Open Questions

1. **Live AI Chat**: Should we support real-time Claude conversations in the site?
   - Pro: Most "magical" experience
   - Con: Requires API key, costs money, privacy concerns
   - Recommendation: Start with static, add as optional feature

2. **Source Code Integration**: Should the site include actual source code files?
   - Pro: True one-stop experience
   - Con: Duplication, staleness, size
   - Recommendation: Link to repo, show snippets only

3. **Versioning**: Support for multiple versions of docs?
   - Important for libraries with breaking changes
   - Can add later as enhancement

4. **Hosting**: Should we include deploy helpers?
   - GitHub Pages, Vercel, Netlify configs
   - Recommendation: Yes, include common deploy configs
