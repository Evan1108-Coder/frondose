import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkBoundMath } from '../lib/document-markdown.js';
import 'katex/dist/katex.min.css';

const MATH_OPTIONS = { trust: false, strict: 'warn', maxExpand: 500, maxSize: 20, throwOnError: false, output: 'htmlAndMathml' };
const REHYPE_PLUGINS = [[rehypeKatex, MATH_OPTIONS]];

/** Separate chunk: ordinary conversation text does not load TeX or its fonts. */
export default function DocumentMath({ content, remarkPlugins, ...props }) {
  return <Markdown {...props} remarkPlugins={[...remarkPlugins, remarkMath, remarkBoundMath]} rehypePlugins={REHYPE_PLUGINS}>{content}</Markdown>;
}
