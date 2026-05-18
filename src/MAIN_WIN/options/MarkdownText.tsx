// components/MarkdownText.tsx
import { greyColor } from '@/Store/Color/grayColor';
import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownTextProps {
	children: string;
	components?: React.ComponentProps<typeof ReactMarkdown>['components'];
	textColor?: string;
	fontSize?: string | number;
	lineHeight?: string | number;
}

const defaultComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
	p: ({ node, ...props }) => <p style={{ margin: '0 0 6px 0' }} {...props} />,
	ul: ({ node, ...props }) => <ul style={{ paddingLeft: 20, margin: '6px 0' }} {...props} />,
	li: ({ node, ...props }) => <li style={{ marginBottom: 4 }} {...props} />,
	strong: ({ node, ...props }) => (
		<strong
			style={{
				color: '#eeeeeeff',
				fontWeight: 700,
				fontStyle: 'italic',
			}}
			{...props}
		/>
	),
	em: ({ node, ...props }) => <em style={{ fontStyle: 'italic' }} {...props} />,
	code: ({ node, ...props }) => (
		<code
			style={{
				backgroundColor: '#1e1e1e',
				padding: '1px 4px',
				borderRadius: 4,
				fontFamily: 'monospace',
			}}
			{...props}
		/>
	),
};

export default function MarkdownText({ children, components, textColor = greyColor(80), fontSize = '20px', lineHeight = 1.4 }: MarkdownTextProps) {
	const wrapperStyle: React.CSSProperties = {
		color: textColor,
		fontSize: fontSize,
		lineHeight: lineHeight,
	};

	return (
		<div style={wrapperStyle}>
			<ReactMarkdown components={{ ...defaultComponents, ...components }}>{children}</ReactMarkdown>
		</div>
	);
}
