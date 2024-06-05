const fs = require("fs");
const splitByMediaQuery = require("./splitByMediaQuery");
const { sha1 } = require("crypto-hash");

const handleApply = ({ compiler, options }) => {
  const { mediaOptions, minify, exclude, chunkFileName, keepOriginal } =
    options;

  const pluginName = "media-query-splitting-plugin";

  compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
    compilation.hooks.processAssets.tap(
      {
        name: pluginName,
        stage: compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
      },
      (assets) => {
        const outputPath = compilation.options.output.path;
        const excludes = Object.values(exclude || {});
        const cssChunks = Object.keys(assets).filter(
          (asset) =>
            /\.css$/.test(asset) &&
            !excludes.some((exclude) => exclude.test(asset))
        );

        const needMergeCommonStyles = Object.values(mediaOptions).some(
          ({ withCommonStyles }) => withCommonStyles
        );
        const needRemoveCommonChunk = Object.values(mediaOptions).every(
          ({ withCommonStyles }) => withCommonStyles
        );
        const cssChunksMedia = Object.keys(mediaOptions).concat("common");
        const cssChunksByMedia = {};

        const promises = [];

        cssChunks.forEach((chunkName) => {
          const asset = assets[chunkName];
          const child = asset.children && asset.children[0];
          const chunkValue =
            typeof asset.source === "function"
              ? asset.source()
              : (child || asset)._value;
          let splittedValue = splitByMediaQuery({
            cssFile: chunkValue,
            mediaOptions,
            minify,
          });
          const chunkId = chunkName.replace(/\..*/, "");

          // Filter empty chunks
          splittedValue = Object.keys(splittedValue).reduce(
            (result, mediaType) => {
              if (splittedValue[mediaType]) {
                result[mediaType] = splittedValue[mediaType];
              }

              return result;
            },
            {}
          );

          // Merge common styles if needed
          if (needMergeCommonStyles && splittedValue.common) {
            splittedValue = Object.keys(splittedValue).reduce(
              (result, mediaType) => {
                if (mediaType === "common") {
                  result[mediaType] = splittedValue[mediaType];
                } else {
                  const { withCommonStyles } = mediaOptions[mediaType];

                  if (withCommonStyles) {
                    result[mediaType] = `${splittedValue.common || ""}${
                      splittedValue[mediaType] || ""
                    }`;
                  } else {
                    result[mediaType] = splittedValue[mediaType];
                  }
                }

                return result;
              },
              {}
            );
          }

          Object.keys(splittedValue).forEach((mediaType) => {
            const splittedMediaChunk = splittedValue[mediaType];
            const isCommon = mediaType === "common";

            // TODO add exclusions (e.g. manual splitted chunks)?
            if (isCommon && (!splittedMediaChunk || needRemoveCommonChunk)) {
              // TODO use optimizeChunks.hook instead
              const path = `${outputPath}/${chunkName}`;
              if (fs.existsSync(path)) {
                fs.unlinkSync(path);
                assets[chunkName] = undefined;
              }

              if (fs.existsSync(`${path}.map`)) {
                fs.unlinkSync(`${path}.map`);
                assets[`${chunkName}.map`] = undefined;
              }
            } else if (splittedMediaChunk) {
              // Add existed chunk for entry chunk code
              const mediaChunkId = chunkId.replace(/.+\//, "");
              cssChunksByMedia[mediaChunkId] =
                cssChunksByMedia[mediaChunkId] || {};

              promises.push(
                new Promise((resolve) => {
                  sha1(splittedMediaChunk).then((hash) => {
                    // default pattern: '[id].[contenthash].css'
                    const splittedMediaChunkNameParts = chunkFileName
                      .split(".")
                      .map((chunkNamePart) => {
                        if (chunkNamePart === "[id]") return chunkId;
                        if (chunkNamePart === "[contenthash]") return hash;
                        return chunkNamePart;
                      });
                    splittedMediaChunkNameParts.splice(1, 0, mediaType);
                    const splittedMediaChunkName = isCommon
                      ? chunkName
                      : splittedMediaChunkNameParts.join(".");

                    cssChunksByMedia[mediaChunkId][
                      cssChunksMedia.indexOf(mediaType)
                    ] = {
                      hash,
                      common:
                        !isCommon && mediaOptions[mediaType].withCommonStyles,
                      prefetch:
                        !isCommon &&
                        !!mediaOptions[mediaType].prefetch &&
                        !!mediaOptions[mediaType].prefetch.filter(
                          (mediaType) =>
                            cssChunksMedia.indexOf(mediaType) !== -1
                        ).length &&
                        mediaOptions[mediaType].prefetch
                          .filter(
                            (mediaType) =>
                              cssChunksMedia.indexOf(mediaType) !== -1
                          )
                          .map((mediaType) =>
                            cssChunksMedia.indexOf(mediaType)
                          ),
                    };
                    if (keepOriginal && isCommon) {
                      assets[splittedMediaChunkName] = {
                        size: () => Buffer.byteLength(chunkValue, "utf8"),
                        source: () => Buffer.from(chunkValue),
                      };
                    } else {
                      // Add chunk to assets
                      assets[splittedMediaChunkName] = {
                        size: () =>
                          Buffer.byteLength(splittedMediaChunk, "utf8"),
                        source: () => Buffer.from(splittedMediaChunk),
                      };
                    }

                    resolve();
                  });
                })
              );
            }
          });
        });

        Promise.all(promises).then(() => {
          // TODO use mainTemplate hook instead
          const entryChunkId = Object.keys(compilation.options.entry)[0];
          const entryChunkName = Object.keys(assets).find((name) =>
            new RegExp(`${entryChunkId}.+js$`).test(name)
          );

          if (assets[entryChunkName]) {
            const entryChunk = assets[entryChunkName].source();
            const updatedEntryChunk = entryChunk.replace(
              "{CSS_CHUNKS_BY_MEDIA:1}",
              `${JSON.stringify(cssChunksByMedia)}`
            );

            assets[entryChunkName] = {
              size: () => Buffer.byteLength(updatedEntryChunk, "utf8"),
              source: () => Buffer.from(updatedEntryChunk),
            };
          }
        });
      }
    );
  });
};

module.exports = handleApply;
