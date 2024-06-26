import type * as ts from 'typescript';
import type { Code } from '../../types';
import { getSlotsPropertyName, hyphenateTag } from '../../utils/shared';
import { endOfLine, newLine } from '../common';
import { TemplateCodegenContext, createTemplateCodegenContext } from '../template/context';
import { forEachInterpolationSegment } from '../template/interpolation';
import type { ScriptCodegenContext } from './context';
import { codeFeatures, type ScriptCodegenOptions } from './index';
import { generateInternalComponent } from './internalComponent';

export function* generateTemplate(
	options: ScriptCodegenOptions,
	ctx: ScriptCodegenContext,
	isClassComponent: boolean,
): Generator<Code> {
	ctx.generatedTemplate = true;

	if (!options.vueCompilerOptions.skipTemplateCodegen) {
		if (isClassComponent) {
			yield `__VLS_template() {${newLine}`;
		}
		else {
			yield `function __VLS_template() {${newLine}`;
		}
		const templateCodegenCtx = createTemplateCodegenContext(new Set());
		yield* generateCtx(options, ctx, isClassComponent);
		yield* generateTemplateContext(options, templateCodegenCtx);
		yield* generateExportOptions(options);
		yield* generateConstNameOption(options);
		yield* generateInternalComponent(options, ctx, templateCodegenCtx);
		yield `}${newLine}`;
	}
	else {
		yield `function __VLS_template() {${newLine}`;
		const templateUsageVars = [...getTemplateUsageVars(options, ctx)];
		yield `// @ts-ignore${newLine}`;
		yield `[${templateUsageVars.join(', ')}]${newLine}`;
		yield `return {}${endOfLine}`;
		yield `}${newLine}`;
	}
}

function* generateExportOptions(options: ScriptCodegenOptions): Generator<Code> {
	yield newLine;
	yield `const __VLS_componentsOption = `;
	if (options.sfc.script && options.scriptRanges?.exportDefault?.componentsOption) {
		const componentsOption = options.scriptRanges.exportDefault.componentsOption;
		yield [
			options.sfc.script.content.substring(componentsOption.start, componentsOption.end),
			'script',
			componentsOption.start,
			codeFeatures.navigation,
		];
	}
	else {
		yield `{}`;
	}
	yield endOfLine;
}

function* generateConstNameOption(options: ScriptCodegenOptions): Generator<Code> {
	if (options.sfc.script && options.scriptRanges?.exportDefault?.nameOption) {
		const nameOption = options.scriptRanges.exportDefault.nameOption;
		yield `const __VLS_name = `;
		yield `${options.sfc.script.content.substring(nameOption.start, nameOption.end)} as const`;
		yield endOfLine;
	}
	else if (options.sfc.scriptSetup) {
		yield `let __VLS_name!: '${options.scriptSetupRanges?.options.name ?? options.fileBaseName.substring(0, options.fileBaseName.lastIndexOf('.'))}'${endOfLine}`;
	}
	else {
		yield `const __VLS_name = undefined${endOfLine}`;
	}
}

function* generateCtx(
	options: ScriptCodegenOptions,
	ctx: ScriptCodegenContext,
	isClassComponent: boolean,
): Generator<Code> {
	yield `let __VLS_ctx!: `;
	if (options.vueCompilerOptions.petiteVueExtensions.some(ext => options.fileBaseName.endsWith(ext))) {
		yield `typeof globalThis & `;
	}
	if (!isClassComponent) {
		yield `InstanceType<__VLS_PickNotAny<typeof __VLS_internalComponent, new () => {}>>`;
	}
	else {
		yield `typeof this`;
	}
	/* CSS Module */
	if (options.sfc.styles.some(style => style.module)) {
		yield `& {${newLine}`;
		for (let i = 0; i < options.sfc.styles.length; i++) {
			const style = options.sfc.styles[i];
			if (style.module) {
				yield `${style.module}: Record<string, string> & ${ctx.helperTypes.Prettify.name}<{}`;
				for (const className of style.classNames) {
					yield* generateCssClassProperty(
						i,
						className.text,
						className.offset,
						'string',
						false,
					);
				}
				yield `>${endOfLine}`;
			}
		}
		yield `}`;
	}
	yield endOfLine;
}

function* generateTemplateContext(
	options: ScriptCodegenOptions,
	templateCodegenCtx: TemplateCodegenContext,
): Generator<Code> {
	/* Components */
	yield `/* Components */${newLine}`;
	yield `let __VLS_otherComponents!: NonNullable<typeof __VLS_internalComponent extends { components: infer C } ? C : {}> & typeof __VLS_componentsOption${endOfLine}`;
	yield `let __VLS_own!: __VLS_SelfComponent<typeof __VLS_name, typeof __VLS_internalComponent & (new () => { ${getSlotsPropertyName(options.vueCompilerOptions.target)}: typeof ${options.scriptSetupRanges?.slots?.name ?? '__VLS_slots'} })>${endOfLine}`;
	yield `let __VLS_localComponents!: typeof __VLS_otherComponents & Omit<typeof __VLS_own, keyof typeof __VLS_otherComponents>${endOfLine}`;
	yield `let __VLS_components!: typeof __VLS_localComponents & __VLS_GlobalComponents & typeof __VLS_ctx${endOfLine}`; // for html completion, TS references...

	/* Style Scoped */
	yield `/* Style Scoped */${newLine}`;
	yield `type __VLS_StyleScopedClasses = {}`;
	for (let i = 0; i < options.sfc.styles.length; i++) {
		const style = options.sfc.styles[i];
		const option = options.vueCompilerOptions.experimentalResolveStyleCssClasses;
		if (option === 'always' || (option === 'scoped' && style.scoped)) {
			for (const className of style.classNames) {
				yield* generateCssClassProperty(
					i,
					className.text,
					className.offset,
					'boolean',
					true,
				);
			}
		}
	}
	yield endOfLine;
	yield `let __VLS_styleScopedClasses!: __VLS_StyleScopedClasses | keyof __VLS_StyleScopedClasses | (keyof __VLS_StyleScopedClasses)[]${endOfLine}`;
	yield* generateCssVars(options, templateCodegenCtx);

	if (options.templateCodegen) {
		for (const code of options.templateCodegen.codes) {
			yield code;
		}
	}
	else {
		yield `// no template${newLine}`;
		if (!options.scriptSetupRanges?.slots.define) {
			yield `const __VLS_slots = {}${endOfLine}`;
		}
	}

	yield `return ${options.scriptSetupRanges?.slots.name ?? '__VLS_slots'}${endOfLine}`;
}

function* generateCssClassProperty(
	styleIndex: number,
	classNameWithDot: string,
	offset: number,
	propertyType: string,
	optional: boolean,
): Generator<Code> {
	yield `${newLine} & { `;
	yield [
		'',
		'style_' + styleIndex,
		offset,
		codeFeatures.navigationWithoutRename,
	];
	yield `'`;
	yield [
		classNameWithDot.substring(1),
		'style_' + styleIndex,
		offset + 1,
		codeFeatures.navigation,
	];
	yield `'`;
	yield [
		'',
		'style_' + styleIndex,
		offset + classNameWithDot.length,
		codeFeatures.navigationWithoutRename,
	];
	yield `${optional ? '?' : ''}: ${propertyType}`;
	yield ` }`;
}

function* generateCssVars(options: ScriptCodegenOptions, ctx: TemplateCodegenContext): Generator<Code> {
	if (!options.sfc.styles.length) {
		return;
	}
	yield `// CSS variable injection ${newLine}`;
	for (const style of options.sfc.styles) {
		for (const cssBind of style.cssVars) {
			for (const [segment, offset, onlyError] of forEachInterpolationSegment(
				options.ts,
				ctx,
				cssBind.text,
				cssBind.offset,
				options.ts.createSourceFile('/a.txt', cssBind.text, 99 satisfies ts.ScriptTarget.ESNext),
			)) {
				if (offset === undefined) {
					yield segment;
				}
				else {
					yield [
						segment,
						style.name,
						cssBind.offset + offset,
						onlyError
							? codeFeatures.navigation
							: codeFeatures.all,
					];
				}
			}
			yield endOfLine;
		}
	}
	yield `// CSS variable injection end ${newLine}`;
}

export function getTemplateUsageVars(options: ScriptCodegenOptions, ctx: ScriptCodegenContext) {

	const usageVars = new Set<string>();
	const components = new Set(options.sfc.template?.ast?.components);

	if (options.templateCodegen) {
		// fix import components unused report
		for (const varName of ctx.bindingNames) {
			if (components.has(varName) || components.has(hyphenateTag(varName))) {
				usageVars.add(varName);
			}
		}
		for (const component of components) {
			if (component.indexOf('.') >= 0) {
				usageVars.add(component.split('.')[0]);
			}
		}
		for (const [varName] of options.templateCodegen.accessExternalVariables) {
			usageVars.add(varName);
		}
	}

	return usageVars;
}
