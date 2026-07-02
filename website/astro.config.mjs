// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
//
// NOTE on `site`/`base`: intentionally unset (site served at root). All internal
// links in src/content/docs/**/*.md are root-relative (e.g. `/getting-started/`),
// which Starlight's own nav/assets auto-prefix with `base` but plain Markdown
// links do not. If this ends up deployed as a GitHub Pages *project* page
// (https://kmjnnhyk.github.io/loopy/), set `base: '/loopy'` here AND rewrite the
// Markdown cross-links to be base-aware first — otherwise every hand-written
// `[text](/section/page/)` link in the docs 404s under the `/loopy` prefix.
export default defineConfig({
	integrations: [
		starlight({
			title: 'loopy',
			description:
				'React for agents — a type-safe TypeScript DSL for LLM agents, tools, workflows, and teams.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kmjnnhyk/loopy' }],
			editLink: {
				baseUrl: 'https://github.com/kmjnnhyk/loopy/edit/master/website/',
			},
			sidebar: [
				{ label: 'Getting Started', slug: 'getting-started' },
				{
					label: 'Core Concepts',
					items: [
						{ label: 'The Step spine', slug: 'core-concepts/step' },
						{ label: 'Schemas (IO)', slug: 'core-concepts/schemas' },
						{ label: 'Dependency injection', slug: 'core-concepts/dependency-injection' },
						{ label: 'Channels & state', slug: 'core-concepts/channels-and-state' },
						{ label: 'Event sourcing & replay', slug: 'core-concepts/event-sourcing' },
					],
				},
				{
					label: 'API Reference',
					items: [
						{ label: 'Overview', slug: 'reference' },
						{ label: 'tool()', slug: 'reference/tool' },
						{ label: 'agent()', slug: 'reference/agent' },
						{ label: 'workflow()', slug: 'reference/workflow' },
						{ label: 'team()', slug: 'reference/team' },
						{ label: 'Channels', slug: 'reference/channels' },
						{ label: 'Registry (defineLoopy / loopy)', slug: 'reference/registry' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Writing a tool', slug: 'guides/tools' },
						{ label: 'An agent with tools', slug: 'guides/agent-with-tools' },
						{ label: 'A deterministic workflow', slug: 'guides/workflows' },
						{ label: 'A multi-agent team', slug: 'guides/multi-agent-team' },
						{ label: 'Human-in-the-loop', slug: 'guides/human-in-the-loop' },
					],
				},
				{ label: 'The team model, explained', slug: 'team-model' },
				{ label: 'Status & Roadmap', slug: 'status-roadmap' },
			],
		}),
	],
});
