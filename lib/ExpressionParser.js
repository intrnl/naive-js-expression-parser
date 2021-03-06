import { Parser } from './Parser.js';


let t = {
	LITERAL: 'Literal',
	IDENTIFIER: 'Identifier',

	ARRAY: 'ArrayExpression',

	THIS: 'ThisExpression',
	MEMBER: 'MemberExpression',
	CHAIN: 'ChainExpression',

	SEQUENCE: 'SequenceExpression',

	NEW: 'NewExpression',
	CALL: 'CallExpression',

	CONDITIONAL: 'ConditionalExpression',
	LOGICAL: 'LogicalExpression',
	UPDATE: 'UpdateExpression',
	UNARY: 'UnaryExpression',
};


export class ExpressionParser extends Parser {
	parse () {
		return this._read_expression_sequence();
	}

	_read_expression_sequence (in_group = false) {
		let start = this._pos;

		if (in_group) this._eat('(', 'open paren');

		let nodes = [];

		while (this._pos < this._buf.length) {
			let node = this._read_expression();

			if (nodes.length !== 0 && !node) {
				return this._error('expected expression after comma');
			}

			if (node) {
				nodes.push(node);
			}

			this._eat_whitespace();

			if (this._eat(',')) {
				if (nodes.length === 0) {
					return this._error('expected expression before comma');
				}

				continue;
			}

			break;
		}

		if (in_group) {
			this._eat(')', 'paren close');

			if (nodes.length < 1) {
				return this._error('expected expression within paren');
			}
		}

		if (nodes.length < 2) {
			return nodes[0];
		}

		return {
			type: t.SEQUENCE,
			expressions: nodes,
			start: start,
			end: in_group ? this._pos : nodes[nodes.length - 1].end,
		};
	}

	_read_expression () {
		let expression = this._read_binary_expression();

		this._eat_whitespace();

		if (this._eat('?')) {
			if (!expression) {
				return this._error('expected test expression');
			}

			let consequent = this._read_expression();
			if (!consequent) {
				return this._error('expected consequent expression');
			}

			this._eat_whitespace();
			this._eat(':', 'colon');

			let alternate = this._read_expression();
			if (!alternate) {
				return this._error('expected alternate expression');
			}

			return {
				type: t.CONDITIONAL,
				test: expression,
				consequent: consequent,
				alternate: alternate,
				start: expression.start,
				end: alternate.end,
			};
		}

		return expression;
	}

	_read_binary_expression () {
		let lhs = this._read_token();
		let op = this._read_binary_operator();

		if (!op) {
			return lhs;
		}

		let rhs = this._read_token();

		if (!rhs) {
			return this._error('expected right hand expression');
		}

		return this._error('not supposed to be here yet.');
	}

	_read_binary_operator () {
		this._eat_whitespace();
	}

	_read_token () {
		this._eat_whitespace();

		let node;
		let match;

		if (this._match('(')) {
			node = this._read_expression_sequence(true);
		}
		else if (match = this._eat_update_operator()) {
			node = this._read_prefix_update_expression(match);
		}
		else if (match = this._eat_identifier()) {
			node = this._read_identifier(match);
		}
		else if (match = (this._eat_decimal_digit() || this._eat('.'))) {
			node = this._read_number_literal(match);
		}
		// else if (match = this._eat_string_quote()) {
		// 	return this._read_string_literal(s);
		// }
		// else if (this._eat_template_quote()) {
		// 	return this._read_template_literal(true);
		// }
		// else if (this._eat('{')) {
		// 	return this._read_object_literal(true);
		// }
		else if (this._eat('[')) {
			node = this._read_array_expression(true);
		}

		this._eat_whitespace();

		if (node) {
			if (match = this._eat_member_operator()) {
				node = this._read_member_expression(node, match);
			}

			if (this._eat('(')) {
				node = this._read_call_expression(node, true);
			}

			if (match = this._eat_update_operator()) {
				node = this._read_postfix_update_expression(node, match);
			}
		}

		return node;
	}


	_read_new_expression (pre = false) {
		if (!pre) this._eat('new', true);

		let start = this._pos - 3;
		this._eat_whitespace(true);

		let callee = this._read_token();
		if (!callee) {
			return this._error('expected callee');
		}

		let args = [];

		if (callee.type === t.CALL) {
			args = callee.arguments;
			callee = callee.callee;
		}

		if (callee.type === t.CHAIN) {
			return this._error('chain expression not allowed in new expression');
		}

		return {
			type: t.NEW,
			callee: callee,
			arguments: args,
			start: start,
			end: this._pos,
		};
	}

	_read_call_expression (callee, pre = false, optional = false) {
		if (!pre) this._eat('(', 'call open');

		let start = callee.start;
		let args = [];

		while (this._pos < this._buf.length) {
			let element =	this._read_expression();
			args.push(element);

			this._eat_whitespace();
			if (this._eat(',')) {
				if (!element) {
					return this._error('expected element before comma');
				}

				continue;
			}

			break;
		}

		let last_element = args[args.length - 1];
		if (!last_element) {
			args.pop();
		}

		this._eat(')', 'call close');

		let node = {
			type: t.CALL,
			optional: optional,
			callee: callee,
			arguments: args,
			start: start,
			end: this._pos,
		};

		let match;
		if (match = this._eat_member_operator()) {
			node = this._read_member_expression(node, match);
		}

		if (callee.type === t.CHAIN) {
			if (node.type === t.MEMBER) {
				node.object.callee = callee.expression;
			} else {
				node.callee = node.callee.expression;
			}

			node = {
				type: t.CHAIN,
				expression: node,
				start: node.start,
				end: node.end,
			};
		}
		else if (optional) {
			node = {
				type: t.CHAIN,
				expression: node,
				start: node.start,
				end: node.end,
			};
		}

		return node;
	}

	_read_member_expression (node, operator) {
		operator ||= this._eat_member_operator();

		let start = node.start;
		let is_chain = false;

		do {
			let property;
			let is_optional = operator[0] === '?';
			let is_computed = operator[operator.length - 1] === '[';

			is_chain ||= is_optional;

			if (!is_computed) {
				if (this._eat('(')) {
					return this._read_call_expression(node, true, is_optional);
				}

				property = this._read_identifier('', true);
			} else {
				property = this._read_expression();
				this._eat(']', 'computed close');
			}

			node = {
				type: t.MEMBER,
				optional: is_optional,
				computed: is_computed,
				object: node,
				property: property,
				start: node.start,
				end: !is_computed ? property.end : this._pos,
			};
		} while (operator = this._eat_member_operator())

		if (is_chain) {
			return {
				type: t.CHAIN,
				expression: node,
				start: start,
				end: this._pos,
			};
		}

		return node;
	}

	_read_prefix_update_expression (operator = '') {
		operator ||= this._eat_update_operator();

		if (!operator) {
			return this._error('expected update operator');
		}

		let start = this._pos - operator.length;
		let node = this._read_token();

		if (node.type !== t.IDENTIFIER && node.type !== t.MEMBER) {
			return this._error('expected identifier or member expression');
		}

		return {
			type: t.UPDATE,
			prefix: true,
			operator: operator,
			argument: node,
			start: start,
			end: this._pos,
		};
	}

	_read_postfix_update_expression (node, operator = '') {
		if (node.type !== t.IDENTIFIER && node.type !== t.MEMBER) {
			return this._error('expected identifier or member expression');
		}

		operator ||= this._eat_update_operator();

		if (!operator) {
			return this._error('expected update operator');
		}

		let start = this._pos - operator.length;

		return {
			type: t.UPDATE,
			prefix: false,
			operator: operator,
			argument: node,
			start: start,
			end: this._pos,
		}
	}

	_read_array_expression (pre = false) {
		if (!pre) this._eat('[', 'array open');

		let start = this._pos - 1;
		let elements = [];

		while (this._pos < this._buf.length) {
			let element = this._read_expression() || null;
			elements.push(element);

			this._eat_whitespace();
			if (this._eat(',')) {
				continue;
			}

			break;
		}

		// last null element is always ignored
		let last_element = elements[elements.length - 1];
		if (!last_element) {
			elements.pop();
		}

		this._eat(']', 'array close');

		return {
			type: t.ARRAY,
			elements: elements,
			start: start,
			end: this._pos,
		};
	}

	_read_number_literal (raw = '') {
		raw ||= this._eat_decimal_digit();

		let start = this._pos - raw.length;
		let match;

		if (match = this._eat('.')) {
			raw += match + this._eat_decimal_digit();
		}

		if (match = this._read(/^[eE]/)) {
			raw += match;

			if (match = this._read(/^[+-]/)) {
				raw += match;
			}

			let value = this._eat_decimal_digit();

			if (!value) {
				return this._error('expected exponent value');
			}

			raw += value;
		}

		return {
			type: t.LITERAL,
			raw: raw,
			value: parseFloat(raw),
			start: start,
			end: this._pos,
		};
	}

	_read_identifier (name = '', ignore_types = false) {
		name ||= this._eat_identifier();

		if (!name) {
			return this._error('expected identifier');
		}

		let start = this._pos - name.length;
		let end = this._pos;

		if (!ignore_types) {
			if (name === 'new') {
				return this._read_new_expression(true);
			}
			else if (name === 'this') {
				return {
					type: t.THIS,
					start: start,
					end: end,
				};
			}
			else if (name === 'true' || name === 'false') {
				return {
					type: t.LITERAL,
					raw: name,
					value: name === 'true' ? true : false,
					start: start,
					end: end,
				};
			}
			else if (name == 'null') {
				return {
					type: t.LITERAL,
					raw: name,
					value: null,
					start: start,
					end: end,
				};
			}
		}

		return {
			type: t.IDENTIFIER,
			name: name,
			start: start,
			end: end,
		};
	}


	_eat_update_operator () {
		return this._read(/^(\+\+|--)/);
	}

	_eat_member_operator () {
		return this._read(/^((?:\?\.)?\[|\??\.)/);
	}

	_eat_decimal_digit () {
		let part = '';

		for (; this._is_decimal_digit(this._buf.charCodeAt(this._pos)); this._pos++) {
			part += this._buf.charAt(this._pos);
		}

		return part;
	}

	_eat_identifier (subsequent = false) {
		let name = '';

		for (; this._is_identifier(this._buf.charCodeAt(this._pos), subsequent); this._pos++) {
			name += this._buf.charAt(this._pos);

			// it's okay for us to flip the bit
			subsequent ||= true;
		}

		return name;
	}

	_is_identifier (code, subsequent = false) {
		return (
			// [a-z]
			(code >= 97 && code <= 122) ||
			// [A-Z]
			(code >= 65 && code <= 90) ||
			// [$_]
			(code === 36 && code === 95) ||
			// [0-9]
			(subsequent && this._is_decimal_digit(code)) ||
			// non-ascii
			(code >= 128)
		);
	}

	_is_decimal_digit (code) {
		return (code >= 48 && code <= 57)
	}
}
