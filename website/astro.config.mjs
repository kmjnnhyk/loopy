// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Deployed as a GitHub Pages *project* page: https://kmjnnhyk.github.io/loopy/
const SITE = 'https://kmjnnhyk.github.io';
const BASE = '/loopy';

// Starlight's own nav/sidebar/assets auto-prefix links with `base`, but plain
// author-written Markdown links (`[x](/reference/tool/)`) do not — under the
// `/loopy` prefix they'd 404. This rehype plugin prefixes every root-absolute
// internal href/src with BASE at build time, so we keep writing natural
// `/section/page/` links in content and they resolve correctly. Dependency-free
// hast walk (no unist-util-visit import needed).
function rehypeBaseLinks() {
	const prefix = (url) =>
		typeof url === 'string' &&
		url.startsWith('/') &&
		!url.startsWith('//') && // protocol-relative
		!url.startsWith(BASE + '/') &&
		url !== BASE
			? BASE + url
			: url;
	const walk = (node) => {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'element' && node.properties) {
			if (node.tagName === 'a') node.properties.href = prefix(node.properties.href);
			if (node.tagName === 'img') node.properties.src = prefix(node.properties.src);
		}
		if (Array.isArray(node.children)) for (const child of node.children) walk(child);
	};
	return (tree) => walk(tree);
}

// https://astro.build/config
export default defineConfig({
	site: SITE,
	base: BASE,
	markdown: { rehypePlugins: [rehypeBaseLinks] },
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
