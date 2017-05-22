'use strict'
var HTMLParser = require('htmlparser2/lib/Parser')
var styleParser = require('style-parser')
var trim = require('lodash.trim')
var md5

function parseSimple (variant, context, node) {
  var children
  if (node.children) {
    children = parseNodes(node.children, {
      options: context.options
    }).children
  }
  var result = {
    type: 'text',
    children: children
  }
  if (variant === 'blockquote') {
    result.blockquote = 1
  } else if (variant) {
    result[variant] = true
  }
  if (!context.children) {
    context.children = []
  }
  context.children.push(result)
  return result
}

function parseHeader (enlarge, context, node) {
  context.children.push({
    type: 'br'
  })
  var simpleNode = parseSimple(null, context, node)
  simpleNode.bold = true
  simpleNode.enlarge = enlarge
}

function traditionalCodeBlock (context, node) {
  context.children.push({
    type: 'code',
    text: trim(firstChildContent(node))
  })
}

function list (variant, context, node) {
  var result = {
    type: 'list',
    variant: variant,
    children: [],
    options: context.options
  }
  node.children.forEach(function (child) {
    parseSimple(null, result, child)
  })
  delete result.options
  context.children.push(result)
}

function ignore (context, node) {
  if (node.children) {
    parseNodes(node.children, context)
  }
}

function parseStyle (context, node) {
  var fontSize = style(node, 'font-size')
  var parsed
  var enlarge = 0
  if (fontSize && (parsed = /^([0-9]+)\s*px\s*$/i.exec(fontSize))) {
    var num = parseInt(parsed[1], 10)
    if (num > 68) {
      enlarge += 1
    }
    if (num > 56) {
      enlarge += 1
    }
    if (num > 42) {
      enlarge += 1
    }
    if (num > 30) {
      enlarge += 1
    }
    if (num > 21) {
      enlarge += 1
    }
  }
  var bold = style(node, 'font-weight') === 'bold'
  var italic = /(^|\s)italic(\s|$)/i.test(style(node, 'font-style'))
  var underline = /(^|\s)underline(\s|$)/i.test(style(node, 'text-decoration')) ||
    (context.options.evernote && style(node, '-evernote-highlight') === 'true')
  var strikeThrough = /(^|\s)line-through(\s|$)/i.test(style(node, 'text-decoration'))
  var addedNode = parseSimple(null, context, node)
  if (enlarge !== 0) {
    addedNode.enlarge = enlarge
  }
  if (bold) {
    addedNode.bold = true
  }
  if (underline) {
    addedNode.underline = true
  }
  if (strikeThrough) {
    addedNode.strike = true
  }
  if (italic) {
    addedNode.italic = true
  }
}

function style (node, prop) {
  if (!node.style) {
    if (!node.attribs || !node.attribs.style) {
      return ''
    }
    node.style = styleParser(node.attribs.style)
  }
  return node.style[prop] || ''
}

function firstChildContent (node) {
  if (!node.children) {
    return
  }
  if (node.children.length === 0) {
    return
  }
  return node.children[0].content
}

function singleNode (type, context, node) {
  context.children.push({
    type: type
  })
}

var tags = {
  'img': function (context, node) {
    context.children.push({
      type: 'img',
      src: node.attribs.src
    })
  },
  'a': function (context, node) {
    var childData = parseNodes(node.children, {
      options: context.options
    })
    context.children.push({
      type: 'text',
      href: node.attribs.href,
      children: childData.children
    })
  },
  'note': function (context, node) {
    if (context.options && context.options.evernote) {
      var content
      if (!context.options.resources) {
        context.options.resources = {}
      }
      node.children.forEach(function (child) {
        if (child.tagName === 'title') {
          context.title = firstChildContent(child)
        } else if (child.tagName === 'tag') {
          if (!context.tags) {
            context.tags = []
          }
          context.tags.push(firstChildContent(child))
        } else if (child.tagName === 'content') {
          content = firstChildContent(child)
        } else if (child.tagName === 'resource') {
          if (!md5) {
            // Lazy-load md5 because it is not necessarily required
            md5 = require('nano-md5')
          }
          var resource = {}
          child.children.forEach(function (resourceChild) {
            if (resourceChild.tagName === 'data') {
              resource.encoded = firstChildContent(resourceChild)
            } else if (resourceChild.tagName === 'mime') {
              resource.mime = firstChildContent(resourceChild)
            }
          })
          if (/^image\/(png|jpeg|gif)$/.test(resource.mime)) {
            var raw = new Buffer(resource.encoded, 'base64')
            var hash = md5.fromBytes(raw.toString('latin1')).toHex()
            context.options.resources[hash] = {
              type: 'img',
              src: 'data:' + resource.mime + ';base64,' + resource.encoded
            }
          }
        }
      })
      if (content) {
        var contentNodes = parseHTML(content)
        parseNode(context, {
          children: contentNodes
        })
      }
    }
  },
  'en-media': function (context, node) {
    if (node.attribs && context.options.resources && context.options.evernote) {
      var resource = context.options.resources[node.attribs.hash]
      if (resource) {
        context.children.push(resource)
      }
    }
  },
  'br': singleNode.bind(null, 'br'),
  'td': function (context, node) {
    var simple = parseSimple(null, context, node)
    simple.type = 'td'
  },
  'tbody': ignore,
  'tr': function (context, node) {
    var result = {
      type: 'tr',
      children: [],
      options: context.options
    }
    if (node.children) {
      parseNodes(node.children.filter(function (node) {
        return node.tagName === 'td'
      }), result)
    }
    delete result.options
    context.children.push(result)
  },
  'table': function (context, node) {
    var result = {
      type: 'table',
      children: [],
      options: context.options
    }
    if (node.children) {
      parseNodes(node.children, result)
    }
    delete result.options
    context.children.push(result)
  },
  'span': parseStyle,
  'font': parseStyle,
  'code': traditionalCodeBlock,
  'pre': traditionalCodeBlock,
  'h1': parseHeader.bind(null, 5),
  'h2': parseHeader.bind(null, 4),
  'h3': parseHeader.bind(null, 3),
  'h4': parseHeader.bind(null, 2),
  'h5': parseHeader.bind(null, 1),
  'ol': list.bind(null, 'ol'),
  'ul': list.bind(null, 'ul'),
  'div': function (context, node) {
    // <en-todo> are inline tags which are super weird.
    // This way .checkNode will be filled somehow.
    if (
      context.options.evernote &&
      node.children &&
      node.children.length >= 1 &&
      node.children[0].tagName === 'en-todo'
    ) {
      // Remove the check node
      var checkNode = node.children.shift()
      var result = {
        type: 'check',
        checked: checkNode.attribs && /^true$/i.test(checkNode.attribs.checked),
        children: [],
        options: context.options
      }
      parseSimple(null, result, checkNode)
      delete result.options
      context.checkNode = result
      return
    }

    // The fontfamily, namely the Monaco or Consolas font indicates
    // that we are in a code block
    if (
      context.options.evernote &&
      node.children &&
      style(node, '-en-codeblock') === 'true'
    ) {
      var data = []
      node.children.forEach(function (child) {
        if (
          child.tagName === 'div' &&
          child.children.length === 1 &&
          child.children[0].type === 'Text'
        ) {
          data.push(firstChildContent(child))
        }
      })
      context.children.push({
        type: 'code',
        text: data.join('\n')
      })
      return
    }

    parseSimple(null, context, node)

    // A line break after a div ensures that the formatting stays readable
    context.children.push({
      type: 'br'
    })
  },
  'hr': singleNode.bind(null, 'hr'),
  'blockquote': parseSimple.bind(null, 'blockquote'),
  'b': parseSimple.bind(null, 'bold'),
  'strong': parseSimple.bind(null, 'bold'),
  'i': parseSimple.bind(null, 'italic'),
  'em': parseSimple.bind(null, 'italic'),
  'u': parseSimple.bind(null, 'underline'),
  's': parseSimple.bind(null, 'strike')
}

function parseNodes (nodes, context) {
  if (!context.children) {
    context.children = []
  }
  var checklist = null
  var applyChecklist = function (index) {
    if (checklist) {
      context.children.splice(checklist.index, 0, {
        type: 'list',
        variant: 'ul',
        children: checklist.entries
      })
      checklist = null
    }
  }
  nodes.forEach(function (node) {
    if (node.type === 'Text' && node.content === '\n') {
      return
    }
    parseNode(context, node)
    if (context.checkNode) {
      if (!checklist) {
        checklist = {
          index: context.children.length,
          entries: []
        }
      }
      checklist.entries.push(context.checkNode)
      delete context.checkNode
    } else if (node.tagName === 'br' || node.tagName === 'div') {
      applyChecklist(node)
    }
  })
  applyChecklist()
  return context
}

function parseNode (context, node) {
  if (!node.tagName) {
    if (node.type === 'Text') {
      context.children.push({
        type: 'text',
        text: node.content
      })
    }
  }
  var parser = tags[node.tagName]
  if (parser) {
    parser(context, node)
  } else if (node.type === 'Text') {
    parseSimple(null, context, node)
  } else {
    ignore(context, node)
  }
}

function reduceSameProperties (tokens, parent) {
  if (tokens.length === 0) {
    return
  }
  ['bold', 'underline', 'strike', 'italic', 'href'].forEach(function (prop) {
    var value = tokens[0][prop]
    for (var i = 1; i < tokens.length; i++) {
      if (tokens[i][prop] !== value) {
        return
      }
    }
    tokens.forEach(function (token) {
      delete token[prop]
    })
    if (value !== undefined) {
      parent[prop] = value
    }
  })
}

function reduceSimpleNodes (tokens, parent) {
  tokens = tokens.filter(function (token) {
    if (token.type !== 'text') {
      return true
    }
    if (token.children) {
      return true
    }
    if (token.text === undefined || token.text === null) {
      return false
    }
    if (/^\s+$/i.test(token.text)) {
      return false
    }
    token.text = trim(token.text)
    return true
  })
  var allText = true
  tokens.forEach(function (token) {
    if (token.children) {
      token.children = reduceSimpleNodes(token.children, token)
    }
    if (token.type !== 'text') {
      allText = false
    }
    if (
      token.type === 'text' &&
      token.children &&
      token.children.length === 1 &&
      (
        token.children[0].type === 'text' ||
        token.children[0].type === 'img'
      )
    ) {
      var targetToken = token.children[0]
      if (token.href && targetToken.href) {
        return
      }
      token.type = targetToken.type
      if (targetToken.src) {
        token.src = targetToken.src
      }
      if (targetToken.href) {
        token.href = targetToken.href
      }
      if (targetToken.bold || token.bold) {
        token.bold = true
      }
      if (targetToken.italic || token.italic) {
        token.italic = true
      }
      if (targetToken.strike || token.strike) {
        token.strike = true
      }
      if (targetToken.underline || token.underline) {
        token.underline = true
      }
      if (targetToken.enlarge) {
        token.bold = true
        token.enlarge = (token.enlarge || 0) + targetToken.enlarge
      }
      if (targetToken.blockquote) {
        token.blockquote = (token.blockquote || 0) + targetToken.blockquote
      }
      if (targetToken.children) {
        token.children = targetToken.children
      } else {
        delete token.children
      }
      if (targetToken.text) {
        token.text = targetToken.text
      } else {
        delete token.text
      }
    }
  })
  if (allText && tokens.length > 1) {
    reduceSameProperties(tokens, parent)
  }
  return tokens.filter(function (token) {
    if (!token.children && token.hasOwnProperty('children')) {
      delete token.children
    }
    return !token.children || token.children.length !== 0 || parent.type === 'tr'
  })
}

function parseHTML (input) {
  var current = {}
  var stack = []
  var root = current
  var parser = new HTMLParser({
    onopentag: function (name, attribs) {
      stack.push(current)
      var next = {
        tagName: name
      }
      if (Object.keys(attribs).length > 0) {
        next.attribs = attribs
      }
      if (!current.children) {
        current.children = []
      }
      current.children.push(next)
      current = next
    },
    ontext: function (text) {
      if (!current.children) {
        current.children = []
      }
      current.children.push({
        type: 'Text',
        content: text
      })
    },
    onclosetag: function (tagName) {
      if (current.tagName === tagName) {
        current = stack.pop()
        return
      }
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tagName) {
          while (stack.length > i) {
            current = stack.pop()
          }
          return
        }
      }
      // ignore tags that are ever opened
    }
  }, {
    recognizeCDATA: true,
    decodeEntities: true
  })
  parser.write(String(input))
  parser.end()
  return root.children || []
}

module.exports = function (input, options) {
  var htmlNodes = parseHTML(input)
  var tokens = parseNodes(htmlNodes, {
    title: null,
    options: options || {},
    children: []
  })
  delete tokens.options
  tokens.children = reduceSimpleNodes(tokens.children, tokens)
  // console.log(JSON.stringify(tokens, null, 2))
  return tokens
}