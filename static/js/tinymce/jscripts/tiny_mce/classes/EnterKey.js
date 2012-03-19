/**
 * EnterKey.js
 *
 * Copyright 2012, Moxiecode Systems AB
 * Released under LGPL License.
 *
 * License: http://tinymce.moxiecode.com/license
 * Contributing: http://tinymce.moxiecode.com/contributing
 */

(function(tinymce) {
	var TreeWalker = tinymce.dom.TreeWalker;

	/**
	 * Contains logic for handling the enter key to split/generate block elements.
	 */
	tinymce.EnterKey = function(editor) {
		var dom = editor.dom, selection = editor.selection, settings = editor.settings, undoManager = editor.undoManager;

		function handleEnterKey(evt) {
			var rng = selection.getRng(true), tmpRng, container, offset, parentBlock, newBlock, fragment, containerBlock, parentBlockName, containerBlockName, newBlockName;

			// Returns true if the block can be split into two blocks or not
			function canSplitBlock(node) {
				return node && dom.isBlock(node) && !/^(TD|TH|CAPTION)$/.test(node.nodeName) && !/^(fixed|absolute)/i.test(node.style.position);
			};

			// Moves the caret to a suitable position within the root for example in the first non pure whitespace text node or before an image
			function moveToCaretPosition(root) {
				var walker, node, rng, y, viewPort, lastNode = root;

				rng = dom.createRng();

				if (root.hasChildNodes()) {
					walker = new TreeWalker(root, root);

					while (node = walker.current()) {
						if (node.nodeType == 3) {
							rng.setStart(node, 0);
							rng.setEnd(node, 0);
							break;
						}

						if (/^(BR|IMG)$/.test(node.nodeName)) {
							rng.setStartBefore(node);
							rng.setEndBefore(node);
							break;
						}

						lastNode = node;
						node = walker.next();
					}

					if (!node) {
						rng.setStart(lastNode, 0);
						rng.setEnd(lastNode, 0);
					}
				} else {
					if (root.nodeName == 'BR') {
						rng.setStartAfter(root);
						rng.setEndAfter(root);
					} else {
						rng.setStart(root, 0);
						rng.setEnd(root, 0);
					}
				}

				selection.setRng(rng);

				viewPort = dom.getViewPort(editor.getWin());

				// scrollIntoView seems to scroll the parent window in most browsers now including FF 3.0b4 so it's time to stop using it and do it our selfs
				y = dom.getPos(root).y;
				if (y < viewPort.y || y + 25 > viewPort.y + viewPort.h) {
					editor.getWin().scrollTo(0, y < viewPort.y ? y : y - viewPort.h + 25); // Needs to be hardcoded to roughly one line of text if a huge text block is broken into two blocks
				}
			};

			// Creates a new block element by cloning the current one or creating a new one if the name is specified
			// This function will also copy any text formatting from the parent block and add it to the new one
			function createNewBlock(name) {
				var node = container, block, clonedNode, caretNode;

				block = name ? dom.create(name) : parentBlock.cloneNode(false);
				caretNode = block;

				// Clone any parent styles
				do {
					if (/^(SPAN|STRONG|B|EM|I|FONT|STRIKE|U)$/.test(node.nodeName)) {
						clonedNode = node.cloneNode(false);
						dom.setAttrib(clonedNode, 'id', ''); // Remove ID since it needs to be document unique

						if (block.hasChildNodes()) {
							clonedNode.appendChild(block.firstChild);
							block.appendChild(clonedNode);
						} else {
							caretNode = clonedNode;
							block.appendChild(clonedNode);
						}
					}
				} while (node = node.parentNode);

				// BR is needed in empty blocks on non IE browsers
				if (!tinymce.isIE) {
					caretNode.innerHTML = '<br>';
				}

				return block;
			};

			// Returns true/false if the caret is at the start/end of the parent block element
			function isCaretAtStartOrEndOfBlock(start) {
				var walker, node;

				// Caret is in the middle of a text node like "a|b"
				if (container.nodeType == 3 && (start ? offset > 0 : offset < container.nodeValue.length)) {
					return false;
				}

				// Walk the DOM and look for text nodes or non empty elements
				walker = new TreeWalker(container, parentBlock);
				while (node = (start ? walker.prev() : walker.next())) {
					if (node.nodeType === 1) {
						// Ignore bogus elements
						if (node.getAttribute('data-mce-bogus')) {
							continue;
						}

						// Keep empty elements like <img />
						name = node.nodeName.toLowerCase();
						if (name === 'IMG') {
							return false;
						}
					} else if (node.nodeType === 3 && !/^[ \t\r\n]*$/.test(node.nodeValue)) {
						return false;
					}
				}

				return true;
			};

			// Wraps any text nodes or inline elements in the specified forced root block name
			function wrapSelfAndSiblingsInDefaultBlock(container, offset) {
				var newBlock, parentBlock, startNode, node, next;

				// Not in a block element or in a table cell or caption
				parentBlock = dom.getParent(container, dom.isBlock);
				if (newBlockName && !evt.shiftKey && (!parentBlock || !canSplitBlock(parentBlock))) {
					parentBlock = parentBlock || dom.getRoot();

					if (!parentBlock.hasChildNodes()) {
						newBlock = dom.create(newBlockName);
						parentBlock.appendChild(newBlock);
						rng.setStart(newBlock, 0);
						rng.setEnd(newBlock, 0);
						return newBlock;
					}

					// Find parent that is the first child of parentBlock
					node = container;
					while (node.parentNode != parentBlock) {
						node = node.parentNode;
					}

					// Loop left to find start node start wrapping at
					while (node && !dom.isBlock(node)) {
						startNode = node;
						node = node.previousSibling;
					}

					if (startNode) {
						newBlock = dom.create(newBlockName);
						startNode.parentNode.insertBefore(newBlock, startNode);

						// Start wrapping until we hit a block
						node = startNode;
						while (node && !dom.isBlock(node)) {
							next = node.nextSibling;
							newBlock.appendChild(node);
							node = next;
						}

						// Restore range to it's past location
						rng.setStart(container, offset);
						rng.setEnd(container, offset);
					}
				}

				return container;
			};

			// Inserts a block or br before/after or in the middle of a split list of the LI is empty
			function handleEmptyListItem() {
				function isFirstOrLastLi(first) {
					var node = containerBlock[first ? 'firstChild' : 'lastChild'];

					// Find first/last element since there might be whitespace there
					while (node) {
						if (node.nodeType == 1) {
							break;
						}

						node = node[first ? 'nextSibling' : 'previousSibling'];
					}

					return node === parentBlock;
				};

				newBlock = newBlockName ? createNewBlock(newBlockName) : dom.create('BR');

				if (isFirstOrLastLi(true) && isFirstOrLastLi()) {
					// Is first and last list item then replace the OL/UL with a text block
					dom.replace(newBlock, containerBlock);
				} else if (isFirstOrLastLi(true)) {
					// First LI in list then remove LI and add text block before list
					containerBlock.parentNode.insertBefore(newBlock, containerBlock);
				} else if (isFirstOrLastLi()) {
					// Last LI in list then temove LI and add text block after list
					dom.insertAfter(newBlock, containerBlock);
				} else {
					// Middle LI in list the split the list and insert a text block in the middle
					// Extract after fragment and insert it after the current block
					tmpRng = rng.cloneRange();
					tmpRng.setStartAfter(parentBlock);
					tmpRng.setEndAfter(containerBlock);
					fragment = tmpRng.extractContents();
					dom.insertAfter(fragment, containerBlock);
					dom.insertAfter(newBlock, containerBlock);
				}

				dom.remove(parentBlock);
				moveToCaretPosition(newBlock);
				undoManager.add();
			};

			// Walks the parent block to the right and look for BR elements
			function hasRightSideBr() {
				var walker = new TreeWalker(container, parentBlock), node;

				while (node = walker.current()) {
					if (node.nodeName == 'BR') {
						return true;
					}

					node = walker.next();
				}
			}
			
			// Inserts a BR element if the forced_root_block option is set to false or empty string
			function insertBr() {
				var brElm, extraBr, documentMode;

				if (container && container.nodeType == 3 && offset >= container.nodeValue.length) {
					// Insert extra BR element at the end block elements
					if (!tinymce.isIE && !hasRightSideBr()) {
						brElm = dom.create('br')
						rng.insertNode(brElm);
						rng.setStartAfter(brElm);
						rng.setEndAfter(brElm);
						extraBr = true;
					}
				}

				brElm = dom.create('br');
				rng.insertNode(brElm);

				// Rendering modes below IE8 doesn't display BR elements in PRE unless we have a \n before it
				documentMode = dom.doc.documentMode;
				if (tinymce.isIE && parentBlockName == 'PRE' && (!documentMode || documentMode < 8)) {
					brElm.parentNode.insertBefore(dom.doc.createTextNode('\r'), brElm);
				}

				if (!extraBr) {
					rng.setStartAfter(brElm);
					rng.setEndAfter(brElm);
				} else {
					rng.setStartBefore(brElm);
					rng.setEndBefore(brElm);
				}

				selection.setRng(rng);
				undoManager.add();
			};

			// Trims any linebreaks at the beginning of node user for example when pressing enter in a PRE element
			function trimLeadingLineBreaks(node) {
				do {
					if (node.nodeType === 3) {
						node.nodeValue = node.nodeValue.replace(/^[\r\n]+/, '');
					}

					node = node.firstChild;
				} while (node);
			};
		
			// Delete any selected contents
			if (!rng.collapsed) {
				editor.execCommand('Delete');
				return;
			}

			// Event is blocked by some other handler for example the lists plugin
			if (evt.isDefaultPrevented()) {
				return;
			}

			// Setup range items and newBlockName
			container = rng.startContainer;
			offset = rng.startOffset;
			newBlockName = settings.forced_root_block;
			newBlockName = newBlockName ? newBlockName.toUpperCase() : '';

			// Resolve node index
			if (container.nodeType == 1 && container.hasChildNodes()) {
				container = container.childNodes[Math.min(offset, container.childNodes.length - 1)] || container;
				offset = 0;
			}

			undoManager.beforeChange();

			// Wrap the current node and it's sibling in a default block if it's needed.
			// for example this <td>text|<b>text2</b></td> will become this <td><p>text|<b>text2</p></b></td>
			container = wrapSelfAndSiblingsInDefaultBlock(container, offset);

			// Find parent block and setup empty block paddings
			parentBlock = dom.getParent(container, dom.isBlock);
			containerBlock = parentBlock ? dom.getParent(parentBlock.parentNode, dom.isBlock) : null;

			// Setup block names
			parentBlockName = parentBlock ? parentBlock.nodeName.toUpperCase() : ''; // IE < 9 & HTML5
			containerBlockName = containerBlock ? containerBlock.nodeName.toUpperCase() : ''; // IE < 9 & HTML5

			// Handle enter inside an empty list item
			if (parentBlockName == 'LI' && dom.isEmpty(parentBlock)) {
				// Let the list plugin or browser handle nested lists for now
				if (/^(UL|OL|LI)$/.test(containerBlock.parentNode.nodeName)) {
					return false;
				}

				handleEmptyListItem();
				return;
			}

			// Don't split PRE tags but insert a BR instead easier when writing code samples etc
			if (parentBlockName == 'PRE' && settings.br_in_pre !== false) {
				if (!evt.shiftKey) {
					insertBr();
					return;
				}
			} else {
				// If no root block is configured then insert a BR by default or if the shiftKey is pressed
				if ((!newBlockName && !evt.shiftKey && parentBlockName != 'LI') || (newBlockName && evt.shiftKey)) {
					insertBr();
					return;
				}
			}

			// Default block name if it's not configured
			newBlockName = newBlockName || 'P';

			// Insert new block before/after the parent block depending on caret location
			if (isCaretAtStartOrEndOfBlock()) {
				// If the caret is at the end of a header we produce a P tag after it similar to Word unless we are in a hgroup
				if (/^(H[1-6]|PRE)$/.test(parentBlockName) && containerBlockName != 'HGROUP') {
					newBlock = createNewBlock(newBlockName);
				} else {
					newBlock = createNewBlock();
				}

				// Split the current container block element if enter is pressed inside an empty inner block element
				if (settings.end_container_on_empty_block && canSplitBlock(containerBlock) && dom.isEmpty(parentBlock)) {
					// Split container block for example a BLOCKQUOTE at the current blockParent location for example a P
					newBlock = dom.split(containerBlock, parentBlock);
				} else {
					dom.insertAfter(newBlock, parentBlock);
				}
			} else if (isCaretAtStartOrEndOfBlock(true)) {
				// Insert new block before
				newBlock = parentBlock.parentNode.insertBefore(createNewBlock(), parentBlock);
			} else {
				// Extract after fragment and insert it after the current block
				tmpRng = rng.cloneRange();
				tmpRng.setEndAfter(parentBlock);
				fragment = tmpRng.extractContents();
				trimLeadingLineBreaks(fragment);
				newBlock = fragment.firstChild;
				dom.insertAfter(fragment, parentBlock);
			}

			dom.setAttrib(newBlock, 'id', ''); // Remove ID since it needs to be document unique
			moveToCaretPosition(newBlock);
			undoManager.add();
		}

		editor.onKeyDown.add(function(ed, evt) {
			if (evt.keyCode == 13) {
				if (handleEnterKey(evt) !== false) {
					evt.preventDefault();
				}
			}
		});
	};
})(tinymce);