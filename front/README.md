# Work Adventure Fronten

## Architecture

```txt
.
├── dist
│   ├── ga.html.tmpl                    (GoogleAnalytics code to copy into the index.html template)
│   ├── index.html
│   ├── index.tmpl.html                 (Template file for index.html with slot for GoogleAnalytics)
│   ├── resources
│   │   ├── characters/                 (PNG-TileSets for characters choosable in the character creation menu)
│   │   ├── customisation               (Additional PNG-TileSets to customize characters with)
│   │   │   ├── character_accessories
│   │   │   ├── character_clothes
│   │   │   ├── character_color
│   │   │   ├── character_eyes
│   │   │   ├── character_hairs
│   │   │   └── character_hats
│   │   ├── fonts/                      (Font files (PNG, XML, TTF))
│   │   ├── html
│   │   │   ├── gameMenu.html           (GameMenu that opens when you press the hamburger button in top left corner.)
│   │   │   ├── gameMenuIcon.html       (Hamburger-Icon-HTML for said menu)
│   │   │   ├── gameQualityMenu.html    (Menu to set game and video quality)
│   │   │   ├── gameReport.html         (Menu to block and/or report another user)
│   │   │   └── gameShare.html          (Menu with current room url to share)
│   │   ├── items
│   │   │   └── computer/               (PNG-Tileset of Pixel-Computer and an atlas file???)
│   │   ├── logos/                      (Icons used for buttons, cursor, etc.)
│   │   ├── objects/                    (More icons, but just for buttons in the game and a few mp3 sound files)
│   │   └── style
│   │       └── style.css               (General styling for various parts of the HTML game UI)
│   └── static
│       └── images                      (Various image files, why??)
│           ├── favicons/
│           └── maps/                   (Looks like screenshots of some maps from the original team at thecodingmachine)
├── Dockerfile                          (Builds the frontend and packs it into an nginx container)
├── jasmine.json                        (Config for the jasmine test framework)
├── LICENSE.txt
├── nginx-vhost.conf                    (nginx config to host frontend, probably used in docker image)
├── package.json
├── README.md
├── src
│   ├── Administration/                 (Appears to be code for the admin UI)
│   ├── Connexion                       (Frenchified: Connection)
│   │   ├── ConnectionManager.ts        (User login & websocket connection to server)
│   │   ├── ConnexionModels.ts          (Mostly TS types of messages sent to/from backend websocket)
│   │   ├── LocalUserStore.ts           (Accessors to store userdata in localstorage)
│   │   ├── LocalUser.ts                (TS class of local user data (uuid, jwt, characterTexture))
│   │   ├── RoomConnection.ts           (!!! handles room related updates and rpc calls via websocket connection)
│   │   └── Room.ts                     (Room class with utility methods)
│   ├── Enum
│   │   └── EnvironmentVariable.ts      (exports various env values, e.g API_URL)
│   ├── Exception
│   │   └── TextureError.ts             (empty error class)
│   ├── index.ts                        (Configures and starts Phaser to display game UI)
│   ├── Logger
│   │   └── MessageUI.ts                (???)
│   ├── Network
│   │   └── ProtobufClientUtils.ts      (Conversion method for PositionMessage -> Point)
│   ├── Phaser
│   │   ├── Components
│   │   │   ├── ChatModeIcon.ts
│   │   │   ├── ClickButton.ts
│   │   │   ├── Loader.ts
│   │   │   ├── OpenChatIcon.ts
│   │   │   ├── PresentationModeIcon.ts
│   │   │   ├── SoundMeterSprite.ts
│   │   │   ├── SoundMeter.ts
│   │   │   ├── TextField.ts
│   │   │   └── TextInput.ts
│   │   ├── Entity
│   │   │   ├── Character.ts
│   │   │   ├── PlayerTexturesLoadingManager.ts
│   │   │   ├── PlayerTextures.ts
│   │   │   ├── RemotePlayer.ts
│   │   │   ├── SpeechBubble.ts
│   │   │   └── Sprite.ts
│   │   ├── Game
│   │   │   ├── AddPlayerInterface.ts
│   │   │   ├── GameManager.ts
│   │   │   ├── GameMap.ts
│   │   │   ├── GameScene.ts
│   │   │   ├── PlayerMovement.ts
│   │   │   └── PlayersPositionInterpolator.ts
│   │   ├── Items
│   │   │   ├── ActionableItem.ts
│   │   │   ├── Computer
│   │   │   │   └── computer.ts
│   │   │   └── ItemFactoryInterface.ts
│   │   ├── Login
│   │   │   ├── AbstractCharacterScene.ts
│   │   │   ├── CustomizeScene.ts
│   │   │   ├── EnableCameraScene.ts
│   │   │   ├── EntryScene.ts
│   │   │   ├── LoginScene.ts
│   │   │   ├── ResizableScene.ts
│   │   │   └── SelectCharacterScene.ts
│   │   ├── Map
│   │   │   └── ITiledMap.ts
│   │   ├── Menu
│   │   │   ├── MenuScene.ts
│   │   │   └── ReportMenu.ts
│   │   ├── Player
│   │   │   ├── Animation.ts
│   │   │   └── Player.ts
│   │   ├── Reconnecting
│   │   │   ├── ErrorScene.ts
│   │   │   ├── ReconnectingScene.ts
│   │   │   └── WAError.ts
│   │   ├── Shaders
│   │   │   └── OutlinePipeline.ts
│   │   └── UserInput
│   │       └── UserInputManager.ts
│   ├── types.ts
│   ├── Url
│   │   └── UrlManager.ts
│   └── WebRtc
│       ├── AudioManager.ts
│       ├── BlackListManager.ts
│       ├── CopyrightInfo.ts
│       ├── CoWebsiteManager.ts
│       ├── DiscussionManager.ts
│       ├── HtmlUtils.ts
│       ├── JitsiFactory.ts
│       ├── LayoutManager.ts
│       ├── MediaManager.ts
│       ├── ScreenSharingPeer.ts
│       ├── SimplePeer.ts
│       └── VideoPeer.ts
├── templater.sh
├── tests
│   └── Phaser
│       └── Game
│           ├── HtmlUtilsTest.ts
│           ├── PlayerMovementTest.ts
│           ├── PlayerTexturesLoadingTest.ts
│           └── RoomTest.ts
├── tsconfig.json
├── webpack.config.js
├── webpack.prod.js
└── yarn.lock
```

_(Generated with `tree -L 5 -I "node_modules|Messages|*.png|*.mp3|*.svg"`, then shortended by hand)_
