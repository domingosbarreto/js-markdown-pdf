'use strict';
var path = require('path');
var fs = require('fs');
var url = require('url');
var os = require('os');
var INSTALL_CHECK = false;

async function markdownPdf(option_type, uri) {
  try {

    var mdfilename = uri.fsPath;
    var ext = path.extname(mdfilename);

    var types_format = ['html', 'pdf', 'png', 'jpeg'];
    var filename = '';
    var types = [];
    if (types_format.indexOf(option_type) >= 0) {
      types[0] = option_type;
    }

    // convert and export markdown to pdf, html, png, jpeg
    if (types && Array.isArray(types) && types.length > 0) {
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        if (types_format.indexOf(type) >= 0) {
          filename = mdfilename.replace(ext, '.' + type);
          var text = readFile(mdfilename);
          var content = convertMarkdownToHtml(mdfilename, type, text);
          var html = makeHtml(content, uri);
          await exportPdf(html, filename, type, uri);
        } else {
          showErrorMessage('markdownPdf().2 Supported formats: html, pdf, png, jpeg.');
          return;
        }
      }
    } else {
      showErrorMessage('markdownPdf().3 Supported formats: html, pdf, png, jpeg.');
      return;
    }
  } catch (error) {
    showErrorMessage('markdownPdf()', error);
  }
}

/*
 * convert markdown to html (markdown-it)
 */
function convertMarkdownToHtml(filename, type, text) {
  var grayMatter = require("gray-matter");
  var matterParts = grayMatter(text);

  try {
    try {
      var hljs = require('highlight.js');
      var breaks = setBooleanValue(matterParts.data.breaks, false);
      var md = require('markdown-it')({
        html: true,
        breaks: breaks,
        highlight: function (str, lang) {

          if (lang && lang.match(/\bmermaid\b/i)) {
            return `<div class="mermaid">${str}</div>`;
          }

          if (lang && hljs.getLanguage(lang)) {
            try {
              str = hljs.highlight(lang, str, true).value;
            } catch (error) {
              str = md.utils.escapeHtml(str);

              showErrorMessage('markdown-it:highlight', error);
            }
          } else {
            str = md.utils.escapeHtml(str);
          }
          return '<pre class="hljs"><code><div>' + str + '</div></code></pre>';
        }
      });
    } catch (error) {
      showErrorMessage('require(\'markdown-it\')', error);
    }

    // convert the img src of the markdown
    var cheerio = require('cheerio');
    var defaultRender = md.renderer.rules.image;
    md.renderer.rules.image = function (tokens, idx, options, env, self) {
      var token = tokens[idx];
      var href = token.attrs[token.attrIndex('src')][1];
      // console.log("original href: " + href);
      if (type === 'html') {
        href = decodeURIComponent(href).replace(/("|')/g, '');
      } else {
        href = convertImgPath(href, filename);
      }
      // console.log("converted href: " + href);
      token.attrs[token.attrIndex('src')][1] = href;
      // // pass token to default renderer.
      return defaultRender(tokens, idx, options, env, self);
    };

    if (type !== 'html') {
      // convert the img src of the html
      md.renderer.rules.html_block = function (tokens, idx) {
        var html = tokens[idx].content;
        var $ = cheerio.load(html);
        $('img').each(function () {
          var src = $(this).attr('src');
          var href = convertImgPath(src, filename);
          $(this).attr('src', href);
        });
        return $.html();
      };
    }

    // checkbox
    md.use(require('markdown-it-checkbox'));

    // emoji
    var emoji_f = setBooleanValue(matterParts.data.emoji, true);
    if (emoji_f) {
      var emojies_defs = require(path.join(__dirname, 'data', 'emoji.json'));
      try {
        var options = {
          defs: emojies_defs
        };
      } catch (error) {
        showErrorMessage('markdown-it-emoji:options', error);
      }
      md.use(require('markdown-it-emoji'), options);
      md.renderer.rules.emoji = function (token, idx) {
        var emoji = token[idx].markup;
        var emojipath = path.join(__dirname, 'node_modules', 'emoji-images', 'pngs', emoji + '.png');
        var emojidata = readFile(emojipath, null).toString('base64');
        if (emojidata) {
          return '<img class="emoji" alt="' + emoji + '" src="data:image/png;base64,' + emojidata + '" />';
        } else {
          return ':' + emoji + ':';
        }
      };
    }

    // toc
    // https://github.com/leff/markdown-it-named-headers
    var options = {
      slugify: Slug
    }
    md.use(require('markdown-it-named-headers'), options);

    // markdown-it-container
    // https://github.com/markdown-it/markdown-it-container
    md.use(require('markdown-it-container'), '', {
      validate: function (name) {
        return name.trim().length;
      },
      render: function (tokens, idx) {
        if (tokens[idx].info.trim() !== '') {
          return `<div class="${tokens[idx].info.trim()}">\n`;
        } else {
          return `</div>\n`;
        }
      }
    });

    // PlantUML
    // https://github.com/gmunguia/markdown-it-plantuml
    var plantumlOptions = {
      openMarker: matterParts.data.plantumlOpenMarker || '@startuml',
      closeMarker: matterParts.data.plantumlCloseMarker || '@enduml',
      server: 'http://www.plantuml.com/plantuml' || ''
    }
    md.use(require('markdown-it-plantuml'), plantumlOptions);

    // markdown-it-include
    // https://github.com/camelaissani/markdown-it-include
    // the syntax is :[alt-text](relative-path-to-file.md)
    // https://talk.commonmark.org/t/transclusion-or-including-sub-documents-for-reuse/270/13
    md.use(require("markdown-it-include"), {
      root: path.dirname(filename),
      includeRe: /:\[.+\]\((.+\..+)\)/i
    });

    return md.render(matterParts.content);

  } catch (error) {
    showErrorMessage('convertMarkdownToHtml()', error);
  }
}

/*
 * https://github.com/microsoft/vscode/blob/ca4ceeb87d4ff935c52a7af0671ed9779657e7bd/extensions/markdown-language-features/src/slugify.ts#L26
 */
function Slug(string) {
  try {
    var stg = encodeURI(
      string.trim()
        .toLowerCase()
        .replace(/\s+/g, '-') // Replace whitespace with -
        .replace(/[\]\[\!\'\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\_\{\|\}\~\`。，、；：？！…—·ˉ¨‘’“”々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
        .replace(/^\-+/, '') // Remove leading -
        .replace(/\-+$/, '') // Remove trailing -
    );
    return stg;
  } catch (error) {
    showErrorMessage('Slug()', error);
  }
}

/*
 * make html
 */
function makeHtml(data, uri) {
  try {
    // read styles
    var style = '';
    style += readStyles(uri);

    // get title
    var title = path.basename(uri.fsPath);

    // read template
    var filename = path.join(__dirname, 'template', 'template.html');
    var template = readFile(filename);

    // read mermaid javascripts
    var mermaidServer = 'https://unpkg.com/mermaid/dist/mermaid.min.js' || '';
    var mermaid = '<script src=\"' + mermaidServer + '\"></script>';

    // compile template
    var mustache = require('mustache');

    var view = {
      title: title,
      style: style,
      content: data,
      mermaid: mermaid
    };
    return mustache.render(template, view);
  } catch (error) {
    showErrorMessage('makeHtml()', error);
  }
}

/*
 * export a html to a html file
 */
function exportHtml(data, filename) {
  fs.writeFile(filename, data, 'utf-8', function (error) {
    if (error) {
      showErrorMessage('exportHtml()', error);
      return;
    }
  });
}

/*
 * export a html to a pdf file (html-pdf)
 */
async function exportPdf(data, filename, type, uri) {

  if (!INSTALL_CHECK) {
    return;
  }
  if (!checkPuppeteerBinary()) {
    showErrorMessage('Chromium or Chrome does not exist! \
      See https://github.com/yzane/vscode-markdown-pdf#install');
    return;
  }

  var exportFilename = getOutputDir(filename, uri);


  try {
    // export html
    if (type == 'html') {
      exportHtml(data, exportFilename);
      return;
    }

    const puppeteer = require('puppeteer-core');
    // create temporary file
    var f = path.parse(filename);
    var tmpfilename = path.join(f.dir, f.name + '_tmp.html');
    exportHtml(data, tmpfilename);
    var options = {
      executablePath: '' || puppeteer.executablePath(),
      args: ['--lang=' + 'en', '--no-sandbox', '--disable-setuid-sandbox']
      // Setting Up Chrome Linux Sandbox
      // https://github.com/puppeteer/puppeteer/blob/master/docs/troubleshooting.md#setting-up-chrome-linux-sandbox
    };
    const browser = await puppeteer.launch(options);
    const page = await browser.newPage();
    await page.setDefaultTimeout(0);
    await page.goto(tmpfilename, { waitUntil: 'networkidle0' });
    // generate pdf
    // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagepdfoptions
    if (type == 'pdf') {
      // If width or height option is set, it overrides the format option.
      // In order to set the default value of page size to A4, we changed it from the specification of puppeteer.
      var width_option = '';
      var height_option = '';
      var format_option = '';
      if (!width_option && !height_option) {
        format_option = 'A4';
      }
      var landscape_option = false;
      var options = {
        path: exportFilename,
        scale: 1,
        displayHeaderFooter: true,
        headerTemplate: transformTemplate('<div style="font-size: 9px; margin-left: 1cm;"> <span class="title"></span></div> <div style="font-size: 9px; margin-left: auto; margin-right: 1cm; ">%%ISO-DATE%%</div>' || ''),
        footerTemplate: transformTemplate('<div style="font-size: 9px; margin: 0 auto;"> <span class="pageNumber"></span> / <span class="totalPages"></span></div>' || ''),
        printBackground: true,
        landscape: landscape_option,
        pageRanges: '',
        format: format_option,
        width: '',
        height: '',
        margin: {
          top: '1.5cm',
          right: '1cm',
          bottom: '1cm',
          left: '1cm'
        },
        timeout: 0
      };
      await page.pdf(options);
    }

    // generate png and jpeg
    // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagescreenshotoptions
    if (type == 'png' || type == 'jpeg') {
      // Quality options do not apply to PNG images.
      var quality_option;
      if (type == 'png') {
        quality_option = undefined;
      }
      if (type == 'jpeg') {
        quality_option = 100;
      }

      // screenshot size
      var clip_x_option = null;
      var clip_y_option = null;
      var clip_width_option = null;
      var clip_height_option = null;
      var options;
      if (clip_x_option !== null && clip_y_option !== null && clip_width_option !== null && clip_height_option !== null) {
        options = {
          path: exportFilename,
          quality: quality_option,
          fullPage: false,
          clip: {
            x: clip_x_option,
            y: clip_y_option,
            width: clip_width_option,
            height: clip_height_option,
          },
          omitBackground: false,
        }
      } else {
        options = {
          path: exportFilename,
          quality: quality_option,
          fullPage: true,
          omitBackground: false,
        }
      }
      await page.screenshot(options);
    }

    await browser.close();

    // delete temporary file
    if (isExistsPath(tmpfilename)) {
      deleteFile(tmpfilename);
    }

  } catch (error) {
    showErrorMessage('exportPdf()', error);
  }
}

/**
 * Transform the text of the header or footer template, replacing the following supported placeholders:
 *
 * - `%%ISO-DATETIME%%` – For an ISO-based date and time format: `YYYY-MM-DD hh:mm:ss`
 * - `%%ISO-DATE%%` – For an ISO-based date format: `YYYY-MM-DD`
 * - `%%ISO-TIME%%` – For an ISO-based time format: `hh:mm:ss`
 */
function transformTemplate(templateText) {
  if (templateText.indexOf('%%ISO-DATETIME%%') !== -1) {
    templateText = templateText.replace('%%ISO-DATETIME%%', new Date().toISOString().substr(0, 19).replace('T', ' '));
  }
  if (templateText.indexOf('%%ISO-DATE%%') !== -1) {
    templateText = templateText.replace('%%ISO-DATE%%', new Date().toISOString().substr(0, 10));
  }
  if (templateText.indexOf('%%ISO-TIME%%') !== -1) {
    templateText = templateText.replace('%%ISO-TIME%%', new Date().toISOString().substr(11, 8));
  }

  return templateText;
}

function isExistsPath(path) {
  if (path.length === 0) {
    return false;
  }
  try {
    fs.accessSync(path);
    return true;
  } catch (error) {
    console.warn(error.message);
    return false;
  }
}

function isExistsDir(dirname) {
  if (dirname.length === 0) {
    return false;
  }
  try {
    if (fs.statSync(dirname).isDirectory()) {
      return true;
    } else {
      console.warn('Directory does not exist!');
      return false;
    }
  } catch (error) {
    console.warn(error.message);
    return false;
  }
}

function deleteFile(path) {
  var rimraf = require('rimraf')
  rimraf.sync(path);
}

function getOutputDir(filename, resource) {
  try {
    var outputDir;
    if (resource === undefined) {
      return filename;
    }
    var outputDirectory = '';
    if (outputDirectory.length === 0) {
      return filename;
    }

    // Use a home directory relative path If it starts with ~.
    if (outputDirectory.indexOf('~') === 0) {
      outputDir = outputDirectory.replace(/^~/, os.homedir());
      mkdir(outputDir);
      return path.join(outputDir, path.basename(filename));
    }

    // Use path if it is absolute
    if (path.isAbsolute(outputDirectory)) {
      if (!isExistsDir(outputDirectory)) {
        showErrorMessage(`The output directory specified by the markdown-pdf.outputDirectory option does not exist.\
          Check the markdown-pdf.outputDirectory option. ` + outputDirectory);
        return;
      }
      return path.join(outputDirectory, path.basename(filename));
    }
  } catch (error) {
    showErrorMessage('getOutputDir()', error);
  }
}

function mkdir(path) {
  if (isExistsDir(path)) {
    return;
  }
  var mkdirp = require('mkdirp');
  return mkdirp.sync(path);
}

function readFile(filename, encode) {
  if (filename.length === 0) {
    return '';
  }
  if (!encode && encode !== null) {
    encode = 'utf-8';
  }
  if (filename.indexOf('file://') === 0) {
    if (process.platform === 'win32') {
      filename = filename.replace(/^file:\/\/\//, '')
        .replace(/^file:\/\//, '');
    } else {
      filename = filename.replace(/^file:\/\//, '');
    }
  }
  if (isExistsPath(filename)) {
    return fs.readFileSync(filename, encode);
  } else {
    return '';
  }
}

function convertImgPath(src, filename) {
  try {
    var href = decodeURIComponent(src);
    href = href.replace(/("|')/g, '')
      .replace(/\\/g, '/')
      .replace(/#/g, '%23');
    var protocol = url.parse(href).protocol;
    if (protocol === 'file:' && href.indexOf('file:///') !== 0) {
      return href.replace(/^file:\/\//, 'file:///');
    } else if (protocol === 'file:') {
      return href;
    } else if (!protocol || path.isAbsolute(href)) {
      href = path.resolve(path.dirname(filename), href).replace(/\\/g, '/')
        .replace(/#/g, '%23');
      if (href.indexOf('//') === 0) {
        return 'file:' + href;
      } else if (href.indexOf('/') === 0) {
        return 'file://' + href;
      } else {
        return 'file:///' + href;
      }
    } else {
      return src;
    }
  } catch (error) {
    showErrorMessage('convertImgPath()', error);
  }
}

function makeCss(filename) {
  try {
    var css = readFile(filename);
    if (css) {
      return '\n<style>\n' + css + '\n</style>\n';
    } else {
      return '';
    }
  } catch (error) {
    showErrorMessage('makeCss()', error);
  }
}

function readStyles(uri) {
  try {
    var includeDefaultStyles;
    var style = '';
    var styles = '';
    var filename = '';
    var i;

    includeDefaultStyles = true;

    // 1. read the style of the vscode.
    if (includeDefaultStyles) {
      filename = path.join(__dirname, 'styles', 'markdown.css');
      style += makeCss(filename);
    }

    // 3. read the style of the highlight.js.
    var highlightStyle = '';
    var ishighlight = true;
    if (ishighlight) {
      if (highlightStyle) {
        var css = '' || 'github.css';
        filename = path.join(__dirname, 'node_modules', 'highlight.js', 'styles', css);
        style += makeCss(filename);
      } else {
        filename = path.join(__dirname, 'styles', 'tomorrow.css');
        style += makeCss(filename);
      }
    }

    // 4. read the style of the markdown-pdf.
    if (includeDefaultStyles) {
      filename = path.join(__dirname, 'styles', 'markdown-pdf.css');
      style += makeCss(filename);
    }

    return style;
  } catch (error) {
    showErrorMessage('readStyles()', error);
  }
}

function checkPuppeteerBinary() {
  try {
    // settings.json
    var executablePath = ''
    if (isExistsPath(executablePath)) {
      INSTALL_CHECK = true;
      return true;
    }

    // bundled Chromium
    const puppeteer = require('puppeteer-core');
    executablePath = puppeteer.executablePath();
    if (isExistsPath(executablePath)) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    showErrorMessage('checkPuppeteerBinary()', error);
  }
}

/*
 * puppeteer install.js
 * https://github.com/GoogleChrome/puppeteer/blob/master/install.js
 */
function installChromium() {
  try {
    // proxy setting
    setProxy();

    const puppeteer = require('puppeteer-core');
    const browserFetcher = puppeteer.createBrowserFetcher();
    const revision = require(path.join(__dirname, 'node_modules', 'puppeteer-core', 'package.json')).puppeteer.chromium_revision;
    const revisionInfo = browserFetcher.revisionInfo(revision);

    // download Chromium
    browserFetcher.download(revisionInfo.revision, onProgress)
      .then(() => browserFetcher.localRevisions())
      .then(onSuccess)
      .catch(onError);

    function onSuccess(localRevisions) {
      console.log('Chromium downloaded to ' + revisionInfo.folderPath);
      localRevisions = localRevisions.filter(revision => revision !== revisionInfo.revision);
      // Remove previous chromium revisions.
      const cleanupOldVersions = localRevisions.map(revision => browserFetcher.remove(revision));

      if (checkPuppeteerBinary()) {
        INSTALL_CHECK = true;
        return Promise.all(cleanupOldVersions);
      }
    }

    function onError(error) {
      showErrorMessage('Failed to download Chromium! \
        If you are behind a proxy, set the http.proxy option to settings.json and restart Visual Studio Code. \
        See https://github.com/yzane/vscode-markdown-pdf#install', error);
    }

    function onProgress(downloadedBytes, totalBytes) {
      var progress = parseInt(downloadedBytes / totalBytes * 100);
    }
  } catch (error) {
    showErrorMessage('installChromium()', error);
  }
}

function showErrorMessage(msg, error) {
  console.log('ERROR: ' + msg);
  if (error) {
    console.log(error);
  }
}

function setProxy() {
  var https_proxy = '';
  if (https_proxy) {
    process.env.HTTPS_PROXY = https_proxy;
    process.env.HTTP_PROXY = https_proxy;
  }
}

function setBooleanValue(a, b) {
  if (a === false) {
    return false
  } else {
    return a || b
  }
}

function init() {
  try {
    if (checkPuppeteerBinary()) {
      INSTALL_CHECK = true;
    } else {
      installChromium();
    }
  } catch (error) {
    showErrorMessage('init()', error);
  }
}



init();
markdownPdf('pdf', uri);