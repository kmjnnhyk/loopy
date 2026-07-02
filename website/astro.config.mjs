// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Served at the site root via the js.org custom domain (public/CNAME).
// Registration lives in the js-org/js.org repo; until that PR is merged the
// GitHub Pages build still deploys, but every link assumes the site is at '/'.
const SITE = 'https://loopy.js.org';

// https://astro.build/config
export default defineConfig({
	site: SITE,
	integrations: [
		starlight({
			title: 'loopy',
			description:
				'React for agents — a type-safe TypeScript DSL for LLM agents, tools, workflows, and teams.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kmjnnhyk/loopy' }],
			editLink: {
				baseUrl: 'https://github.com/kmjnnhyk/loopy/edit/master/website/',
			},
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				ko: { label: '한국어', lang: 'ko' },
			},
			sidebar: [
				{ label: 'Introduction', translations: { ko: '소개' }, slug: 'introduction' },
				{ label: 'Quick Start', translations: { ko: '빠른 시작' }, slug: 'getting-started' },
				{
					label: 'Core Concepts',
					translations: { ko: '핵심 개념' },
					items: [
						{ label: 'The Step spine', translations: { ko: 'Step 구조' }, slug: 'core-concepts/step' },
						{ label: 'Schemas (IO)', translations: { ko: '스키마 (IO)' }, slug: 'core-concepts/schemas' },
						{
							label: 'Dependency injection',
							translations: { ko: '의존성 주입' },
							slug: 'core-concepts/dependency-injection',
						},
						{
							label: 'Channels & state',
							translations: { ko: '채널과 상태' },
							slug: 'core-concepts/channels-and-state',
						},
						{
							label: 'Event sourcing & replay',
							translations: { ko: '이벤트 소싱과 리플레이' },
							slug: 'core-concepts/event-sourcing',
						},
					],
				},
				{
					label: 'Guides',
					translations: { ko: '가이드' },
					items: [
						{ label: 'Writing a tool', translations: { ko: '툴 만들기' }, slug: 'guides/tools' },
						{
							label: 'An agent with tools',
							translations: { ko: '툴을 쓰는 에이전트' },
							slug: 'guides/agent-with-tools',
						},
						{
							label: 'A deterministic workflow',
							translations: { ko: '결정적 워크플로우' },
							slug: 'guides/workflows',
						},
						{
							label: 'A multi-agent team',
							translations: { ko: '멀티 에이전트 팀' },
							slug: 'guides/multi-agent-team',
						},
						{
							label: 'Human-in-the-loop',
							translations: { ko: '휴먼 인 더 루프' },
							slug: 'guides/human-in-the-loop',
						},
					],
				},
				{
					label: 'API Reference',
					translations: { ko: 'API 레퍼런스' },
					items: [
						{ label: 'Overview', translations: { ko: '개요' }, slug: 'reference' },
						{ label: 'tool()', slug: 'reference/tool' },
						{ label: 'agent()', slug: 'reference/agent' },
						{ label: 'workflow()', slug: 'reference/workflow' },
						{ label: 'team()', slug: 'reference/team' },
						{ label: 'Channels', translations: { ko: '채널' }, slug: 'reference/channels' },
						{
							label: 'Registry (defineLoopy / loopy)',
							translations: { ko: '레지스트리 (defineLoopy / loopy)' },
							slug: 'reference/registry',
						},
					],
				},
				{ label: 'The team model, explained', translations: { ko: '팀 모델 깊이 보기' }, slug: 'team-model' },
				{ label: 'Status & Roadmap', translations: { ko: '현황과 로드맵' }, slug: 'status-roadmap' },
			],
		}),
	],
});
