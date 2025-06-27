const llog = require("learninglab-log");
const path = require("path");
const errorLogger = require("../utils/error-logger");

// exports.fileShared = async ({ event, client}) => {
//   try {
//     const handledImageFiles = ["image/gif", "image/jpeg", "image/png"]
//     magenta(`launching fileShared handler`)
//     magenta(event)
//     const fileInfo = await client.files.info({
//       file: event.file_id,
//     });
//     yellow(`handing ${event.file_id}, here's the fileInfo;`)
//     yellow(fileInfo)
//     if (event.channel_id == process.env.SLACK_EXTERNAL_LINKS_CHANNEL && handledImageFiles.includes(fileInfo.file.mimetype) ) {
//       await handleImageFile(event, client, fileInfo)
//       magenta(`handled image file`)
//     } else if (event.channel_id == process.env.SLACK_FCPXML_CHANNEL && path.extname(fileInfo.file.name) == ".fcpxml" ) {
//       yellow(`handling ${fileInfo.file.name} with ext ${path.extname(fileInfo.file.name)}`)
//       cyan(event)
//       await handleSlackedFcpxml(event, client, fileInfo)
//     } else if (event.channel_id == process.env.SLACK_CREATE_GIF_CHANNEL) {
//         if (["mp4", "mov"].includes(fileInfo.file.filetype)) {
//           yellow(`handling movie ${fileInfo.file.name} with ext ${path.extname(fileInfo.file.name)}`)
//           const gifResult = await makeGif({
//             fileInfo: fileInfo,
//             client: client,
//             event: event,
//             width: 355,
//             height: 200
//           })
//           magenta(gifResult)
//         }
//       cyan(event)
//       // await handleSlackedFcpxml(event, client, fileInfo)
//     }
//   } catch (error) {
//     yellow(`eventHandler.fileShared failed`)
//     console.error(error)
//   }
// }

const handleVisionRequest = async ({ event, client }) => {
  if (event.item && event.item.type === "message") {
    llog.white(event);
    const channelId = event.item.channel;
    const messageTs = event.item.ts; // Timestamp of the message
    try {
      // Call the conversations.history method with the necessary parameters
      const images = [];
      const result = await client.conversations.history({
        channel: channelId,
        oldest: messageTs,
        inclusive: true,
        limit: 1,
      });
      llog.blue(result);
      // Check if the message contains attachments with images
      if (result.messages && result.messages.length > 0) {
        const message = result.messages[0];
        if (message.files && message.files.length > 0) {
          const attachments = message.files;
          // Loop through the attachments and check if there is an image
          for (const attachment of attachments) {
            if (attachment.url_private || attachment.permalink_public) {
              // Log the URL of the image attachment
              images.push(attachment);
              llog.blue(
                `Found an image attachment: ${attachment.url_private || attachment.permalink_public}`,
              );
            }
          }
        }
      }
    } catch (error) {
      llog.red(error);
      errorLogger.logError(error, 'VISION-REQUEST-ERROR');
    }
  }
};

const explainRequest = async ({ event, client }) => {
  try {
    const thisMessage = await client.conversations.history({
      channel: event.item.channel,
      latest: event.item.ts,
      inclusive: true,
      limit: 1,
    });
    const previousMessages = await client.conversations.history({
      channel: event.item.channel,
      latest: event.item.ts,
      inclusive: false,
      limit: 5,
    });
    llog.cyan(thisMessage);
    llog.yellow(previousMessages);
    return "successful explainRequest";
  } catch (error) {
    llog.red(`Error in explainRequest: ${error}`);
    errorLogger.logError(error, 'EXPLAIN-REQUEST-ERROR');
  }
};

exports.reactionAdded = async ({ event, client }) => {
  llog.yellow(`got a reactionAdded: ${event.type}:`);
  llog.cyan(event);
  if (event.reaction == "eyeglasses") {
    llog.blue("vision request");
    let result = await handleVisionRequest({ event, client });
    llog.magenta(result);
  }
  if (event.reaction == "waitwhat") {
    llog.blue("what, what? please explain request.");
    let result = await explainRequest({ event, client });
    llog.magenta(result);
  } else {
  }
};

exports.reactionRemoved = async ({ event }) => {
  llog.yellow(`got a reactionRemoved ${event.type}:`);
  llog.cyan(event);
};

// exports.appHomeOpened = appHomeHandler

exports.parseAll = async ({ event }) => {
  const handledEvents = [
    "message",
    "reaction_added",
    "reaction_removed",
    // "app_home_opened",
    // "file_shared"
  ];
  if (handledEvents.includes(event.type)) {
    llog.blue(`got an event of type ${event.type}, handling this elsewhere`);
    // magenta(event)
  } else {
    llog.yellow(`currently unhandled event of type ${event.type}:`);
    llog.cyan(JSON.stringify(event));
  }
  // const result = await momentBot.momentEventListener(event)
};
