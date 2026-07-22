(function () {
  "use strict";

  const PRODUCT_PROFILE = globalThis.ElAlameinProductProfile?.current;
  if (!PRODUCT_PROFILE) throw new Error("El Alamein product profile was not initialized");

  const SAVE_KEY = "zizi-el-alamein-save-v2";
  const LEGACY_SAVE_KEY = "zizi-el-alamein-save-v1";
  const CHECKPOINT_KEY = "zizi-el-alamein-turn-checkpoint-v1";
  const SESSION_KEY = "zizi-el-alamein-current-session-v1";
  const LANG_KEY = "zizi-el-alamein-lang";
  const AI_HUMAN_SIDE_KEY = "zizi-el-alamein-human-side-v1";
  const AI_GAME_MODE_KEY = "zizi-el-alamein-game-mode-v1";
  const ONLINE_ROOM_SESSION_KEY = "zizi-el-alamein-online-room-v1";
  const TRAINING_LOG_KEY = "zizi-el-alamein-training-log-v1";
  const TRAINING_EVENT_KEY = "zizi-el-alamein-training-events-v1";
  const TRAINING_SESSION_KEY = "zizi-el-alamein-training-session-v1";
  const HUMAN_DEMONSTRATION_RECORDING_KEY = PRODUCT_PROFILE.features.humanLabCaptureIntegrity
    ? "zizi-el-alamein-alpha-human-demonstration-recording-v1"
    : "zizi-el-alamein-human-demonstration-recording-v1";
  const TRAINING_LOG_LIMIT = 420;
  const TRAINING_EVENT_LIMIT = 520;
  const AI_SCORE_BATCH_SIZE = 1;
  const AI_MOVEMENT_PHASE_TIME_BUDGET_MS = 9000;
  const AI_ALPHA_ANALYSIS_INTERVAL_MS = 300;
  const AI_ALPHA_ANALYSIS_SEARCH = Object.freeze({
    iterations: 3,
    maxDepth: 1,
    actionLimit: 5,
    preApplyLimit: 14,
    timeBudgetMs: 24,
    progressInterval: 1,
    progressLimit: 3,
    useCache: true,
  });
  const OPPOSITE_SIDE = { axis: "allied", allied: "axis" };
  const coreRulesPromise = import("./src/core/index.js?v=20260709-zoc-step-1");
  const phaseFlowPromise = import("./src/app/phase-flow.js?v=20260714-empty-movement-confirm-1");
  const menuModeSelectionPromise = import("./src/app/game-mode-selection.js?v=20260717-product-profiles-1");
  const mapZoomPromise = import("./src/app/map-zoom.js?v=20260717-product-profiles-1");
  const mapZoomControlsPromise = import("./src/ui/map-zoom-controls.js?v=20260717-product-profiles-1");
  const aiHeuristicsPromise = import("./src/app/ai-heuristics.js?v=20260708-ai-heuristics-16");
  const aiPhaseSearchPromise = import("./src/app/ai-phase-search.js?v=20260709-ai-projection-1");
  const aiTacticsPromise = import("./src/app/ai-tactics.js?v=20260714-shared-move-performance-1");
  const aiAlphaBrowserPromise = PRODUCT_PROFILE.features.alphaRuntime
    ? import("./src/app/ai-alpha-browser.js?v=20260714-local-preview-1")
    : Promise.resolve(null);
  const aiAlphaPreviewPromise = PRODUCT_PROFILE.features.alphaRuntime
    ? import("./src/app/ai-alpha-preview.js?v=20260714-local-preview-1")
    : Promise.resolve(null);
  const aiHumanDemonstrationPromise = import("./src/app/ai-alpha-human-demonstration.js?v=20260719-human-lab-recovery-1");
  const aiHumanCapturePromise = PRODUCT_PROFILE.features.humanLabCaptureIntegrity
    ? import("./src/app/ai-alpha-human-lab-capture.js?v=20260722-human-lab-continuity-1")
    : Promise.resolve(null);
  const aiHumanRecoveryPromise = PRODUCT_PROFILE.features.humanLabCaptureIntegrity
    ? import("./src/app/ai-alpha-human-lab-recovery.js?v=20260719-human-lab-recovery-1")
    : Promise.resolve(null);
  const aiAlphaEnvironmentAdapterPromise = import("./src/app/ai-alpha-environment-adapter.js?v=20260713-human-recorder-1");
  const aiAlphaTrainingPromise = import("./src/app/ai-alpha-training.js?v=20260713-human-recorder-1");
  const alphaFingerprintPromise = import("../shared/wargame-alpha/fingerprint.js?v=20260713-human-recorder-1");
  const onlineModulesPromise = PRODUCT_PROFILE.features.onlineFriendMatch
    ? Promise.all([
      import("./src/app/supabase-online-transport.js?v=20260714-friend-playtest-1"),
      import("./src/app/online-game-bridge.js?v=20260714-friend-playtest-1"),
      import("./src/ui/online-multiplayer-panel.js?v=20260714-online-menu-fix-1"),
    ]).then(([transport, bridge, panel]) => ({ transport, bridge, panel }))
    : Promise.resolve(null);
  const HIGHLIGHT = {
    selected: "rgba(0, 166, 166, 0.56)",
    reachable: "rgba(34, 124, 118, 0.34)",
    attack: "rgba(168, 72, 50, 0.40)",
    defender: "rgba(178, 49, 49, 0.60)",
    declaredAttack: "rgba(34, 124, 118, 0.22)",
    declaredDefender: "rgba(168, 72, 50, 0.32)",
    currentAttack: "rgba(0, 166, 166, 0.52)",
    currentDefender: "rgba(178, 49, 49, 0.58)",
    retreat: "rgba(236, 167, 42, 0.46)",
    alphaSource: "rgba(183, 137, 44, 0.30)",
    alphaTarget: "rgba(244, 191, 70, 0.54)",
  };

  const UNIT_EN = {
    u01: "1st South African Division, 1st Infantry Brigade",
    u02: "1st South African Division, 2nd Infantry Brigade",
    u03: "1st South African Division, 3rd Infantry Brigade",
    u04: "44th Division, 131st Infantry Brigade",
    u05: "44th Division, 132nd Infantry Brigade",
    u06: "44th Division, 133rd Infantry Brigade",
    u07: "9th Australian Division, 22nd Infantry Brigade",
    u08: "9th Australian Division, 24th Infantry Brigade",
    u09: "9th Australian Division, 26th Infantry Brigade",
    u10: "5th Indian Division, 5th Infantry Brigade",
    u11: "5th Indian Division, 9th Infantry Brigade",
    u12: "2nd New Zealand Division, 5th Infantry Brigade",
    u13: "2nd New Zealand Division, 6th Infantry Brigade",
    u14: "7th Armoured Division, 4th Armoured Brigade",
    u15: "7th Armoured Division, 7th Armoured Brigade",
    u16: "7th Armoured Division, Motor Brigade",
    u17: "8th Armoured Division, 23rd Armoured Brigade",
    u18: "10th Armoured Division, 8th Armoured Brigade",
    u19: "22nd Armoured Brigade",
    u20: "164th Division, 382nd Infantry Regiment",
    u21: "164th Division, 125th Infantry Regiment",
    u22: "164th Division, 433rd Infantry Regiment",
    u23: "15th Panzer Division, 115th Panzergrenadier Regiment",
    u24: "15th Panzer Division, 8th Panzer Regiment",
    u25: "21st Panzer Division, 5th Panzer Regiment",
    u26: "21st Panzer Division, 104th Panzergrenadier Regiment",
    u27: "21st Panzer Division, 200th Panzergrenadier Regiment",
    u28: "90th Light Division, 155th Panzergrenadier Regiment",
    u29: "90th Light Division, 361st Panzergrenadier Regiment",
    u30: "Ramcke Parachute Brigade",
    u31: "Pavia Infantry Division",
    u32: "Brescia Infantry Division",
    u33: "Trento Infantry Division",
    u34: "Bologna Infantry Division",
    u35: "Folgore Parachute Division",
    u36: "Littorio Armoured Division",
    u37: "Ariete Armoured Division",
    u38: "Trieste Motorised Division",
    u39: "161st Indian Motor Brigade",
  };

  const I18N = {
    zh: {
      app: { title: "阿拉曼战役" },
      menu: {
        eyebrow: "北非战役",
        copy: "北非战场上轴心国军队在埃及、叙利亚地区主动发起的最后一次大规模攻势，计划在同盟国增援到来而导致轴心国无法在非洲获得胜利之前借由这次战役击败英国第八集团军。",
        start: "开始战役",
        continue: "继续本回合",
        load: "读取存档",
        noSave: "没有可读取的存档。",
        noCheckpoint: "没有回合开始检查点。",
        loaded: "已读取存档。",
        continued: "已回到本回合开始。",
      },
      ui: {
        eyebrow: "本地热座兵棋",
        menu: "主菜单",
        new: "新战役",
        save: "保存",
        load: "读取",
        charts: "表格",
        aar: "战报",
        finishDeclarations: "完成宣告",
        resolveBattle: "结算下一战斗",
        done: "战斗结束",
        endPhase: "结束阶段",
        mapZoom: "地图缩放",
        mapZoomFit: "自适应",
        mapZoomChoose: "选择地图缩放",
        mapZoomOut: "缩小地图",
        mapZoomIn: "放大地图",
        confirmEmptyMovementPhaseEnd: "本移动阶段尚未移动任何单位。确认已经完成移动并结束阶段吗？",
        selectedUnit: "选中单位",
        combat: "战斗",
        operationsKicker: "Operations Board",
        operations: "战情板",
        log: "记录",
        openLog: "打开",
        closeLog: "收起",
        noSelection: "未选择单位",
      },
      charts: { crt: "战斗结果表", tec: "地形效果表", turn: "回合记录表" },
      aar: {
        eyebrow: "战后报告",
        returnMap: "返回地图",
        menu: "主菜单",
        title: "{side}胜利",
        pendingTitle: "战役进行中",
        subtitle: "第 {turn} 回合 · {reason}",
        losses: "损失统计",
        eliminated: "歼灭单位",
        battles: "战斗记录",
        noEliminated: "尚无歼灭单位。",
      },
      side: { axis: "轴心国", allied: "英军" },
      nationality: { german: "德军", italian: "意军", "british-commonwealth": "英联邦" },
      phase: {
        "axis-move": "轴心国移动阶段",
        "axis-combat": "轴心国战斗阶段",
        "allied-move": "英军移动阶段",
        "allied-combat": "英军战斗阶段",
      },
      terrain: {
        desert: "沙漠",
        highland: "高地",
        settlement: "集落",
        coast: "海岸",
        mediterranean: "地中海",
        britishPosition: "英军阵地",
      },
      text: {
        ready: "可行动",
        disrupted: "混乱",
        attack: "攻击",
        defense: "防御",
        odds: "赔率",
        die: "骰点",
        result: "结果",
        defenderHex: "守方格",
        attackerHexes: "攻击格",
        selectedDefender: "守方",
        selectedAttackers: "攻方",
        addBattle: "加入战斗",
        clear: "清除",
        noDeclared: "尚未宣告战斗。",
        declaredCount: "已宣告 {count} 场战斗。",
        phaseOrders: "阶段命令",
        currentBattle: "当前战斗",
        retreatPrompt: "{unit} 撤退：选择下一格",
        advancePrompt: "战后推进：点击参战单位进入 {hex}",
        skip: "跳过",
        undoMove: "取消移动",
        saved: "局面已保存。",
        loaded: "已读取存档。",
        noSave: "没有找到本地存档。",
        badSave: "存档无法读取。",
        newGame: "战役已开始。",
        noLegalAttackers: "该守军周围没有可参战单位。",
        battleCancelled: "已取消当前宣告。",
        battleDeclared: "宣告战斗：{attackers} 攻击 {defender}。",
        declarationsComplete: "宣告完成，进入战斗结算。",
        combatComplete: "所有宣告战斗已经结算完毕。",
        battleSkipped: "跳过一场已失效的战斗。",
        moved: "{unit} 移动到 {hex}，剩余移动力 {mp}。",
        undoMoved: "{unit} 取消移动，回到 {hex}。",
        cannotMove: "{unit} 不能移动。",
        alreadyMoved: "{unit} 本阶段已经移动。",
        targetOccupied: "目标格已有单位。",
        retreatNeeded: "{unit} 需要撤退 {steps} 格。",
        retreated: "{unit} 撤退到 {hex}。",
        retreatExtra: "{unit} 终点被友军占据，必须继续撤退 1 格。",
        eliminated: "{unit}被歼灭了！",
        advance: "{unit} 战后推进到 {hex}。",
        recover: "{unit} 从混乱中恢复。",
        enterPhase: "进入{phase}。",
        turnStart: "进入第 {turn} 回合。",
        checkpoint: "已保存本回合开始检查点。",
        noBattle: "本阶段没有宣告战斗。",
        allDone: "宣告战斗已经全部结算。",
        pendingCombat: "仍有宣告战斗未结算。",
        exitWin: "{unit} 突破德军战线。",
        fourTurnWin: "4 回合结束，轴心国未达成胜利。",
        ridgeWin: "{unit} 占领阿拉姆哈勒法岭目标阵地。",
        roadWin: "{unit} 占领阿拉曼以东沿海道路。",
      },
      result: {
        AE: "攻方歼灭",
        AR: "攻方撤退 1 格",
        DE: "守方歼灭",
        DR: "守方撤退 {steps} 格",
        Skipped: "失效",
      },
    },
    en: {
      app: { title: "El Alamein" },
      menu: {
        eyebrow: "North African Campaign",
        copy: "The final major Axis offensive launched from the North African theatre toward Egypt and Syria, intended to defeat the Eighth Army before Allied reinforcement made victory in Africa unattainable.",
        start: "Start Campaign",
        continue: "Continue Turn",
        load: "Load Save",
        noSave: "No saved game found.",
        noCheckpoint: "No turn-start checkpoint found.",
        loaded: "Saved game loaded.",
        continued: "Returned to the start of this turn.",
      },
      ui: {
        eyebrow: "Local Hotseat Wargame",
        menu: "Main Menu",
        new: "New Campaign",
        save: "Save",
        load: "Load",
        charts: "Charts",
        aar: "Report",
        finishDeclarations: "Finish Declarations",
        resolveBattle: "Resolve Next Combat",
        done: "Combat Complete",
        endPhase: "End Phase",
        mapZoom: "Map zoom",
        mapZoomFit: "Fit",
        mapZoomChoose: "Choose map zoom",
        mapZoomOut: "Zoom map out",
        mapZoomIn: "Zoom map in",
        confirmEmptyMovementPhaseEnd: "No units have moved during this movement phase. Are you sure you are finished moving and want to end the phase?",
        selectedUnit: "Selected Unit",
        combat: "Combat",
        operationsKicker: "Operations Board",
        operations: "Operations Board",
        log: "Log",
        openLog: "Open",
        closeLog: "Close",
        noSelection: "No unit selected",
      },
      charts: { crt: "Combat Results Table", tec: "Terrain Effects Chart", turn: "Turn Record Track" },
      aar: {
        eyebrow: "After Action Report",
        returnMap: "Return to Map",
        menu: "Main Menu",
        title: "{side} Victory",
        pendingTitle: "Campaign in Progress",
        subtitle: "Turn {turn} · {reason}",
        losses: "Losses",
        eliminated: "Eliminated Units",
        battles: "Combat Record",
        noEliminated: "No units have been eliminated.",
      },
      side: { axis: "Axis", allied: "Allied" },
      nationality: { german: "German", italian: "Italian", "british-commonwealth": "British Commonwealth" },
      phase: {
        "axis-move": "Axis Movement Phase",
        "axis-combat": "Axis Combat Phase",
        "allied-move": "Allied Movement Phase",
        "allied-combat": "Allied Combat Phase",
      },
      terrain: {
        desert: "Desert",
        highland: "High Ground",
        settlement: "Settlement",
        coast: "Coast",
        mediterranean: "Mediterranean",
        britishPosition: "British Position",
      },
      text: {
        ready: "Ready",
        disrupted: "Disrupted",
        attack: "Attack",
        defense: "Defense",
        odds: "Odds",
        die: "Die",
        result: "Result",
        defenderHex: "Defender Hex",
        attackerHexes: "Attacker Hexes",
        selectedDefender: "Defender",
        selectedAttackers: "Attackers",
        addBattle: "Add Combat",
        clear: "Clear",
        noDeclared: "No combats declared.",
        declaredCount: "{count} combats declared.",
        phaseOrders: "Phase Orders",
        currentBattle: "Current Combat",
        retreatPrompt: "{unit} retreats: choose next hex",
        advancePrompt: "Advance after combat: click an attacking unit to enter {hex}",
        skip: "Skip",
        undoMove: "Undo Move",
        saved: "Game saved.",
        loaded: "Saved game loaded.",
        noSave: "No local save found.",
        badSave: "Save could not be loaded.",
        newGame: "Campaign started.",
        noLegalAttackers: "No eligible attacking units are adjacent to that defender.",
        battleCancelled: "Current declaration cancelled.",
        battleDeclared: "Declared combat: {attackers} attack {defender}.",
        declarationsComplete: "Declarations complete. Resolving combat.",
        combatComplete: "All declared combats have been resolved.",
        battleSkipped: "Skipped an invalid combat.",
        moved: "{unit} moved to {hex}, {mp} MP remaining.",
        undoMoved: "{unit} undid movement and returned to {hex}.",
        cannotMove: "{unit} cannot move.",
        alreadyMoved: "{unit} has already moved this phase.",
        targetOccupied: "The destination hex is occupied.",
        retreatNeeded: "{unit} must retreat {steps} hexes.",
        retreated: "{unit} retreated to {hex}.",
        retreatExtra: "{unit} ended on a friendly unit and must retreat 1 more hex.",
        eliminated: "{unit} was eliminated!",
        advance: "{unit} advanced after combat to {hex}.",
        recover: "{unit} recovered from disruption.",
        enterPhase: "Entered {phase}.",
        turnStart: "Turn {turn} begins.",
        checkpoint: "Turn-start checkpoint saved.",
        noBattle: "No combats were declared this phase.",
        allDone: "All declared combats are resolved.",
        pendingCombat: "Declared combats remain unresolved.",
        exitWin: "{unit} broke through the German line.",
        fourTurnWin: "Four turns ended without an Axis victory.",
        ridgeWin: "{unit} occupied an Alam Halfa Ridge objective position.",
        roadWin: "{unit} occupied the coastal road east of El Alamein.",
      },
      result: {
        AE: "Attacker Eliminated",
        AR: "Attacker Retreat 1 Hex",
        DE: "Defender Eliminated",
        DR: "Defender Retreat {steps} Hexes",
        Skipped: "Invalid",
      },
    },
  };

  Object.assign(I18N.zh.menu, {
    copy: "北非战场上轴心国军队在埃及、叙利亚地区主动发起的最后一次大规模攻势，计划在同盟国增援到来而导致轴心国无法在非洲获得胜利之前借由这次战役击败英国第八集团军。",
    continue: "继续游戏",
    continued: "已回到上次离开的局面。",
    noCheckpoint: "没有可继续的局面。",
  });
  Object.assign(I18N.en.menu, {
    copy: "The final major Axis offensive launched from the North African theatre toward Egypt and Syria, intended to defeat the Eighth Army before Allied reinforcement made victory in Africa unattainable.",
    continue: "Continue Game",
    continued: "Returned to the last saved position.",
    noCheckpoint: "No campaign position is available.",
  });
  Object.assign(I18N.zh.text, {
    currentDeclaration: "正在宣告",
    declaredBattles: "已宣告战斗",
    declareInOperations: "在战情板中选择守方和参战部队。",
    chooseDefender: "选择一支相邻有可参战单位的敌军。",
    cancel: "取消",
    defenderOnly: "受攻击地块",
    compactStatus: "阶段",
    noDeclared: "尚未宣告战斗。",
    retreatPrompt: "{unit} 撤退：选择最终撤退格",
    finalRetreat: "最终撤退格",
    combatSummary: "战斗结算",
    lossReport: "战损统计",
    initialStrength: "开局总战力",
    currentStrength: "当前总战力",
    eliminatedUnits: "歼灭单位",
    lostStrength: "歼灭战力",
    victoryImpact: "胜利宣言",
    objectives: "胜利条件",
    ridgeObjectives: "阿拉姆哈勒法岭",
    coastalRoadObjectives: "沿海道路",
    showBattleRecord: "展开战斗记录",
    hideBattleRecord: "收起战斗记录",
    axisImpact: "隆美尔和他的战士们将继续追歼残敌，在中东完成与南方面军的伟大会师！",
    alliedImpactPrefix: "",
    alliedImpactLink: "轴心军攻占苏伊士运河地区的最后希望破灭了",
    alliedImpactSuffix: "，英国第八集团军由此稳住埃及防线，并为随后转入反攻奠定基础。",
    axisFailedTitle: "德军并未实现其既定目标",
    axisFailedText: "这是蒙哥马利赢得了其接手第八集团军以来的第一场胜利，英军正从隆美尔的神话和战败的阴影中脱离。",
    alliedBreakthroughTitle: "德军的战线被突破了！",
    alliedBreakthroughText: "战争的主动权来到了我们手里，而强大的第八集团军将把非洲军团歼灭于非洲的土地上。",
  });
  Object.assign(I18N.en.text, {
    currentDeclaration: "Current Declaration",
    declaredBattles: "Declared Combats",
    declareInOperations: "Select the defender and eligible attacking units on the operations board.",
    chooseDefender: "Select an enemy unit with adjacent eligible attackers.",
    cancel: "Cancel",
    defenderOnly: "Defender Hex",
    compactStatus: "Phase",
    noDeclared: "No combats have been declared.",
    retreatPrompt: "{unit} retreat: choose final retreat hex",
    finalRetreat: "Final Retreat Hex",
    combatSummary: "Combat Resolution",
    lossReport: "Loss Report",
    initialStrength: "Initial Combat Strength",
    currentStrength: "Current Combat Strength",
    eliminatedUnits: "Eliminated Units",
    lostStrength: "Eliminated Strength",
    victoryImpact: "Operational Impact",
    objectives: "Victory Conditions",
    ridgeObjectives: "Alam Halfa Ridge",
    coastalRoadObjectives: "Coastal Road",
    showBattleRecord: "Expand Combat Record",
    hideBattleRecord: "Collapse Combat Record",
    axisImpact: "Rommel and his soldiers will continue the pursuit and complete the great junction with the southern army group in the Middle East.",
    alliedImpactPrefix: "",
    alliedImpactLink: "the Axis army's final hope of seizing the Suez Canal region collapsed",
    alliedImpactSuffix: ", securing the Eighth Army's line in Egypt and opening the way to the counteroffensive.",
    axisFailedTitle: "The Germans did not achieve their stated objective",
    axisFailedText: "This was Montgomery's first victory since taking command of the Eighth Army, and the British Army began to emerge from the shadow of Rommel's legend and earlier defeats.",
    alliedBreakthroughTitle: "The German line has been broken!",
    alliedBreakthroughText: "The initiative has passed to us, and the powerful Eighth Army will destroy the Afrika Korps on African soil.",
  });
  Object.assign(I18N.zh.aar, {
    losses: "战损统计",
    battles: "战斗记录",
  });
  Object.assign(I18N.en.aar, {
    losses: "Loss Report",
    battles: "Combat Record",
  });

  Object.assign(I18N.zh.text, {
    combatSummary: "战斗结算",
    combatInstruction: "执行提示",
    advanceInstruction: "战后推进",
    retreatInstruction: "撤退执行",
    objectives: "胜利条件",
    ridgeObjectives: "阿拉姆哈勒法岭",
    coastalRoadObjectives: "沿海道路",
    ridgeNone: "未占领",
    ridgeKey: "占领重要据点",
    ridgeFull: "完全占领",
    roadOpen: "未切断",
    roadCut: "被切断",
    roadElAlamein: "占领了阿拉曼",
    roadElAlameinCut: "占领了阿拉曼并切断",
    roadCutTitle: "同盟国的沿海道路被切断",
    roadCutText: "英国第八集团军的士气会比他们的淡水先耗尽",
    roadElAlameinTitle: "非洲军团征服阿拉曼",
    roadElAlameinText: "隆美尔打开了通往亚历山大港的大门",
    ridgeControlTitle: "非洲军团控制阿拉姆哈勒法岭",
    ridgeControlText: "在一览无余的沙漠上英军失去了南翼防线最重要的支撑点",
    ridgeFullTitle: "非洲军团完全控制阿拉姆哈勒法岭",
    ridgeFullText: "在一览无余的沙漠上我们拿下了这个英军南翼防线最重要的支撑点",
    noObjectiveReached: "尚未达成胜利条件。",
    casualtyReport: "战力与歼灭单位",
    germanGroup: "德军",
    italianGroup: "意大利军",
    commonwealthGroup: "英联邦",
    mechanizedTag: "机械化",
    nonMechanizedTag: "非机械化",
    noEliminated: "无歼灭单位",
    axisImpact: "隆美尔和他的战士们将继续追歼残敌，在中东完成与南方面军的伟大会师！",
  });
  Object.assign(I18N.en.text, {
    combatSummary: "Combat Resolution",
    combatInstruction: "Execution Note",
    advanceInstruction: "Advance After Combat",
    retreatInstruction: "Retreat Execution",
    objectives: "Victory Conditions",
    ridgeObjectives: "Alam Halfa Ridge",
    coastalRoadObjectives: "Coastal Road",
    ridgeNone: "Not occupied",
    ridgeKey: "Key position occupied",
    ridgeFull: "Fully occupied",
    roadOpen: "Not cut",
    roadCut: "Cut",
    roadElAlamein: "El Alamein occupied",
    roadElAlameinCut: "El Alamein occupied and road cut",
    roadCutTitle: "Allied coastal road cut",
    roadCutText: "The Eighth Army's morale will run out before its fresh water.",
    roadElAlameinTitle: "Afrika Korps conquers El Alamein",
    roadElAlameinText: "Rommel has opened the road to Alexandria.",
    ridgeControlTitle: "Afrika Korps controls Alam Halfa Ridge",
    ridgeControlText: "On the open desert, the British have lost the key support of their southern flank.",
    ridgeFullTitle: "Afrika Korps fully controls Alam Halfa Ridge",
    ridgeFullText: "Across the open desert, the key support of the British southern flank is ours.",
    noObjectiveReached: "No victory condition has been achieved.",
    casualtyReport: "Losses and Eliminated Units",
    germanGroup: "German",
    italianGroup: "Italian",
    commonwealthGroup: "Commonwealth",
    mechanizedTag: "Mechanized",
    nonMechanizedTag: "Non-mechanized",
    noEliminated: "No eliminated units",
  });
  Object.assign(I18N.zh.aar, {
    losses: "战力与歼灭单位",
    eliminated: "战力与歼灭单位",
  });
  Object.assign(I18N.en.aar, {
    losses: "Losses and Eliminated Units",
    eliminated: "Losses and Eliminated Units",
  });

  Object.assign(I18N.zh.menu, {
    modeLabel: "选择模式",
    hotseatMode: "热座模式",
    onlineMode: "好友联机测试",
  });
  Object.assign(I18N.en.menu, {
    modeLabel: "Choose Mode",
    hotseatMode: "Hotseat Mode",
    onlineMode: "Friend Match",
  });
  I18N.zh.online = {
    setupAria: "好友联机设置",
    guideTitle: "好友联机步骤",
    stepOpen: "两位玩家都打开这个联机测试版，并选择“好友联机测试”。",
    stepConfigure: "双方输入相同的 Project URL 和 publishable key，然后连接测试服务器。",
    stepRoom: "房主选择阵营并创建房间，把房间码发给好友；好友选择另一阵营并加入。",
    stepReady: "双方都点击“准备”，房间会自动开始。轮到自己的阵营时才能操作。",
    sessionNote: "配置只保留在当前浏览器标签页的临时会话中，不写入游戏存档。",
    projectUrlLabel: "Supabase 项目 URL",
    publishableKeyLabel: "Publishable key（不要使用 secret/service-role key）",
    connect: "连接测试服务器",
    switchConfigBlocked: "请先离开当前房间，再更换联机配置。",
    configRequired: "请输入 Project URL 和 publishable key。",
    connecting: "正在建立匿名测试会话……",
    syncFailed: "同步失败：{reason}",
    operationFailed: "{code}：{reason}",
    connected: "已连接测试服务器。可创建房间，或输入好友房间码加入。",
    restoredRoom: "已恢复房间 {roomCode}。",
    restoreFailed: "旧房间无法恢复：{reason}",
    roomAbandoned: "房间 {roomCode} 已中止。",
    roomExpired: "房间 {roomCode} 已过期。",
    offlineSwitchBlocked: "请先离开当前联机房间，再切换离线模式。",
    startFromReady: "联机房间由准备状态启动；不会覆盖本地战役。",
    panel: {
      title: "好友联机测试",
      roomCode: "房间码",
      axis: "轴心国",
      allied: "英军",
      create: "创建房间",
      join: "加入房间",
      ready: "准备",
      notReady: "取消准备",
      reconnect: "重新连接",
      leave: "离开房间",
      offline: "离线",
      connecting: "正在连接",
      connected: "已连接",
      disconnected: "已断开",
      error: "联机错误",
      lobby: "房间大厅",
      active: "对局进行中",
      finished: "对局已结束",
      abandoned: "房间已中止",
      expired: "房间已过期",
      empty: "空位",
      occupied: "已占用",
    },
  };
  I18N.en.online = {
    setupAria: "Friend match setup",
    guideTitle: "Friend match steps",
    stepOpen: "Both players open this online playtest and choose “Friend Match”.",
    stepConfigure: "Enter the same Project URL and publishable key, then connect to the test server.",
    stepRoom: "The host chooses a side and creates a room, then sends the room code to the friend, who joins as the other side.",
    stepReady: "Both players select “Ready”. The match starts automatically, and only the active side can act.",
    sessionNote: "Configuration stays only in this browser tab's temporary session and is never written to a game save.",
    projectUrlLabel: "Supabase Project URL",
    publishableKeyLabel: "Publishable key (never use a secret/service-role key)",
    connect: "Connect to test server",
    switchConfigBlocked: "Leave the current room before changing the online configuration.",
    configRequired: "Enter the Project URL and publishable key.",
    connecting: "Starting an anonymous test session…",
    syncFailed: "Sync failed: {reason}",
    operationFailed: "{code}: {reason}",
    connected: "Connected to the test server. Create a room or enter a friend's room code to join.",
    restoredRoom: "Restored room {roomCode}.",
    restoreFailed: "The previous room could not be restored: {reason}",
    roomAbandoned: "Room {roomCode} was abandoned.",
    roomExpired: "Room {roomCode} expired.",
    offlineSwitchBlocked: "Leave the current online room before switching to an offline mode.",
    startFromReady: "Online matches start when both players are ready and never overwrite a local campaign.",
    panel: {
      title: "Friend Match",
      roomCode: "Room code",
      axis: "Axis",
      allied: "Allied",
      create: "Create room",
      join: "Join room",
      ready: "Ready",
      notReady: "Not ready",
      reconnect: "Reconnect",
      leave: "Leave room",
      offline: "Offline",
      connecting: "Connecting",
      connected: "Connected",
      disconnected: "Disconnected",
      error: "Online error",
      lobby: "Lobby",
      active: "Match active",
      finished: "Match finished",
      abandoned: "Room abandoned",
      expired: "Room expired",
      empty: "Open",
      occupied: "Occupied",
    },
  };
  Object.assign(I18N.zh.ui, {
    exportHumanDemonstration: "\u5bfc\u51fa\u4eba\u7c7b\u793a\u8303",
    exportHumanRecovery: "\u5bfc\u51fa\u53ef\u6062\u590d\u4eba\u7c7b\u793a\u8303",
    humanLabPrivacyNotice: "\u6570\u636e\u4ec5\u4fdd\u5b58\u5728\u6b64\u6d4f\u89c8\u5668\uff1b\u5bfc\u51fa\u7531\u7528\u6237\u4e3b\u52a8\u4e0b\u8f7d\uff1b\u4e0d\u4f1a\u81ea\u52a8\u4e0a\u4f20\u3002",
    humanLabRecoveryAvailable: "\u68c0\u6d4b\u5230 {count} \u4e2a\u53ef\u6062\u590d\u7684\u4eba\u7c7b\u51b3\u7b56\u3002\u53ef\u5148\u5bfc\u51fa\uff0c\u65e0\u9700\u7ee7\u7eed\u8fdb\u5165\u5bf9\u5c40\u3002",
    humanLabCapturePaused: "Human Lab \u91c7\u96c6\u5df2\u6682\u505c\uff1a\u6d4f\u89c8\u5668\u5b58\u50a8\u4e0d\u8db3\u6216\u6062\u590d\u94fe\u4e0d\u4e00\u81f4\u3002\u6e38\u620f\u4ecd\u53ef\u7ee7\u7eed\uff0c\u8bf7\u5148\u5bfc\u51fa\u53ef\u6062\u590d\u6570\u636e\u3002",
    humanLabPersistenceDegraded: "Human Lab \u672c\u5730\u6301\u4e45\u5316\u5df2\u964d\u7ea7\uff0c\u4f46\u5f53\u524d\u9875\u9762\u4ecd\u5728\u7ee7\u7eed\u91c7\u96c6\u3002\u8bf7\u52ff\u5237\u65b0\u6216\u5173\u95ed\u9875\u9762\uff0c\u5b8c\u6210\u5bf9\u5c40\u540e\u7acb\u5373\u5bfc\u51fa\u3002",
    confirmUnexportedHumanDemonstrationNewGame: "\u5f53\u524d\u4eba\u7c7b\u793a\u8303\u5c1a\u672a\u5bfc\u51fa\u3002\u5f00\u59cb\u65b0\u5bf9\u5c40\u524d\u4f1a\u5c06\u5176\u4fdd\u7559\u5728\u672c\u5730\u5f52\u6863\u4e2d\u3002\u662f\u5426\u7ee7\u7eed\uff1f",
    aiThinking: "AI \u6b63\u5728\u6307\u6325 {side}",
    aiAwaitingInput: "AI \u5df2\u5b8c\u6210\u52a8\u4f5c\uff0c\u8bf7\u70b9\u51fb\u9636\u6bb5\u6309\u94ae\u7ee7\u7eed",
    aiWaiting: "\u4f60\u6307\u6325 {side}\uff0cAI \u6307\u6325 {enemy}",
    alphaValidatedModel: "Alpha\uff1a\u5df2\u9a8c\u8bc1\u6a21\u578b",
    alphaValidatedPreviewModel: "Alpha\uff1a\u5df2\u9a8c\u8bc1\u9884\u89c8\u6a21\u578b",
    alphaHeuristicFallback: "Alpha\uff1a\u542f\u53d1\u5f0f\u56de\u9000\uff08\u65e0\u6a21\u578b\uff09",
    alphaModelLoadFailed: "Alpha\uff1a\u6a21\u578b\u52a0\u8f7d\u5931\u8d25\uff0c\u5df2\u56de\u9000",
    trainingData: "\u8bad\u7ec3\u6570\u636e",
    preferenceSamples: "{count} \u4e2a\u504f\u597d\u6837\u672c",
    replayEvents: "{count} \u4e2a\u56de\u653e\u4e8b\u4ef6",
    exportJson: "\u5bfc\u51fa JSON",
    clearTrainingData: "\u6e05\u9664",
    hotseatStatus: "",
    mapZoom: "\u5730\u56fe\u7f29\u653e",
    mapZoomFit: "\u81ea\u9002\u5e94",
    mapZoomChoose: "\u9009\u62e9\u5730\u56fe\u7f29\u653e",
    mapZoomOut: "\u7f29\u5c0f\u5730\u56fe",
    mapZoomIn: "\u653e\u5927\u5730\u56fe",
  });
  Object.assign(I18N.en.ui, {
    exportHumanDemonstration: "Export human demonstrations",
    exportHumanRecovery: "Export recoverable human data",
    humanLabPrivacyNotice: "Data stays in this browser. Export is a user-initiated download. Nothing is uploaded automatically.",
    humanLabRecoveryAvailable: "{count} recoverable human decisions were found. You can export them from this menu without continuing the game.",
    humanLabCapturePaused: "Human Lab capture is paused because browser storage is full or the capture lineage cannot be reconciled. The game can continue; export the recoverable data first.",
    humanLabPersistenceDegraded: "Human Lab local persistence is degraded, but this page is still recording. Do not refresh or close it; export immediately after the game ends.",
    confirmUnexportedHumanDemonstrationNewGame: "This human demonstration has not been exported. It will be preserved in a local archive before a new game starts. Continue?",
    aiThinking: "AI is commanding {side}",
    aiAwaitingInput: "AI has finished. Use the phase buttons to continue",
    aiWaiting: "You command {side}; AI commands {enemy}",
    alphaValidatedModel: "Alpha: validated model",
    alphaValidatedPreviewModel: "Alpha: validated preview model",
    alphaHeuristicFallback: "Alpha: heuristic fallback (no model)",
    alphaModelLoadFailed: "Alpha: model load failed; using fallback",
    trainingData: "Training Data",
    preferenceSamples: "{count} preference samples",
    replayEvents: "{count} replay events",
    exportJson: "Export JSON",
    clearTrainingData: "Clear",
    hotseatStatus: "",
    mapZoom: "Map zoom",
    mapZoomFit: "Fit",
    mapZoomChoose: "Choose map zoom",
    mapZoomOut: "Zoom map out",
    mapZoomIn: "Zoom map in",
  });
  Object.assign(I18N.zh.text, {
    humanDemonstrationExported: "\u5df2\u5bfc\u51fa\u4eba\u7c7b\u793a\u8303\uff1a{count}\u4e2a\u51b3\u7b56",
    humanDemonstrationExportFailed: "\u4eba\u7c7b\u793a\u8303\u5bfc\u51fa\u5931\u8d25\uff1a{reason}",
    humanDemonstrationRecoveryExported: "\u6807\u51c6\u6570\u636e\u96c6\u65e0\u6cd5\u751f\u6210\uff0c\u5df2\u5bfc\u51fa\u539f\u59cb\u6062\u590d\u5305\uff1a{count}\u4e2a\u51b3\u7b56",
    humanLabCapturePaused: "Human Lab \u91c7\u96c6\u5df2\u6682\u505c\uff1b\u5f53\u524d\u6e38\u620f\u5df2\u6062\u590d\uff0c\u8bf7\u5148\u5bfc\u51fa\u53ef\u6062\u590d\u6570\u636e\u3002",
    aiMovementDone: "AI 完成 {side} 移动。",
    aiCombatDone: "AI 完成 {side} 战斗。",
    aiNoMove: "AI 没有找到有利移动。",
    aiNoCombat: "AI 没有宣告战斗。",
  });
  Object.assign(I18N.en.text, {
    humanDemonstrationExported: "Exported human demonstrations: {count} decisions",
    humanDemonstrationExportFailed: "Human-demonstration export failed: {reason}",
    humanDemonstrationRecoveryExported: "The standard dataset could not be built, so a raw recovery bundle was exported: {count} decisions",
    humanLabCapturePaused: "Human Lab capture is paused. The game was restored; export the recoverable data first.",
    aiMovementDone: "AI completed {side} movement.",
    aiCombatDone: "AI completed {side} combat.",
    aiNoMove: "AI found no useful moves.",
    aiNoCombat: "AI declared no combats.",
  });

  const el = {
    body: document.body,
    menuView: document.getElementById("menuView"),
    gameView: document.getElementById("gameView"),
    aarView: document.getElementById("aarView"),
    menuStatus: document.getElementById("menuStatus"),
    langZhButton: document.getElementById("langZhButton"),
    langEnButton: document.getElementById("langEnButton"),
    axisAiModeButton: document.getElementById("axisAiModeButton"),
    alliedAiModeButton: document.getElementById("alliedAiModeButton"),
    hotseatModeButton: document.getElementById("hotseatModeButton"),
    onlineModeButton: document.getElementById("onlineModeButton"),
    onlineSetupPanel: document.getElementById("onlineSetupPanel"),
    onlineProjectUrlInput: document.getElementById("onlineProjectUrlInput"),
    onlinePublishableKeyInput: document.getElementById("onlinePublishableKeyInput"),
    onlineConnectButton: document.getElementById("onlineConnectButton"),
    onlineSetupStatus: document.getElementById("onlineSetupStatus"),
    onlinePanelRoot: document.getElementById("onlinePanelRoot"),
    startCampaignButton: document.getElementById("startCampaignButton"),
    continueCampaignButton: document.getElementById("continueCampaignButton"),
    menuLoadButton: document.getElementById("menuLoadButton"),
    menuExportHumanDemonstrationButton: document.getElementById("menuExportHumanDemonstrationButton"),
    mapImage: document.getElementById("mapImage"),
    hexLayer: document.getElementById("hexLayer"),
    unitLayer: document.getElementById("unitLayer"),
    boardSurface: document.getElementById("boardSurface"),
    boardViewport: document.getElementById("boardViewport"),
    mapZoomStage: document.getElementById("mapZoomStage"),
    mapZoomControls: document.getElementById("mapZoomControls"),
    mapZoomOutButton: document.getElementById("mapZoomOutButton"),
    mapZoomMenuButton: document.getElementById("mapZoomMenuButton"),
    mapZoomMenu: document.getElementById("mapZoomMenu"),
    mapZoomMenuOptions: [...document.querySelectorAll("[data-map-zoom-preference]")],
    mapZoomOutput: document.getElementById("mapZoomOutput"),
    mapZoomInButton: document.getElementById("mapZoomInButton"),
    boardBadge: document.getElementById("boardBadge"),
    turnLabel: document.getElementById("turnLabel"),
    phaseLabel: document.getElementById("phaseLabel"),
    aiStatus: document.getElementById("aiStatus"),
    onlineGameStatus: document.getElementById("onlineGameStatus"),
    selectedUnit: document.getElementById("selectedUnit"),
    combatComposer: document.getElementById("combatComposer"),
    battleList: document.getElementById("battleList"),
    operationsFocus: document.getElementById("operationsFocus"),
    logBlock: document.getElementById("logBlock"),
    logToggleButton: document.getElementById("logToggleButton"),
    logList: document.getElementById("logList"),
    winnerBanner: document.getElementById("winnerBanner"),
    finishDeclarationsButton: document.getElementById("finishDeclarationsButton"),
    resolveBattleButton: document.getElementById("resolveBattleButton"),
    endPhaseButton: document.getElementById("endPhaseButton"),
    menuButton: document.getElementById("menuButton"),
    newGameButton: document.getElementById("newGameButton"),
    saveButton: document.getElementById("saveButton"),
    loadButton: document.getElementById("loadButton"),
    chartsButton: document.getElementById("chartsButton"),
    aarButton: document.getElementById("aarButton"),
    exportHumanDemonstrationButton: document.getElementById("exportHumanDemonstrationButton"),
    humanLabPrivacyNotice: document.getElementById("humanLabPrivacyNotice"),
    humanLabMenuStatus: document.getElementById("humanLabMenuStatus"),
    humanLabGameStatus: document.getElementById("humanLabGameStatus"),
    returnMapButton: document.getElementById("returnMapButton"),
    aarMenuButton: document.getElementById("aarMenuButton"),
    aarTitle: document.getElementById("aarTitle"),
    aarSubtitle: document.getElementById("aarSubtitle"),
    aarSummary: document.getElementById("aarSummary"),
    aarLosses: document.getElementById("aarLosses"),
    aarEliminated: document.getElementById("aarEliminated"),
    aarBattles: document.getElementById("aarBattles"),
    chartsDialog: document.getElementById("chartsDialog"),
    crtImage: document.getElementById("crtImage"),
    tecImage: document.getElementById("tecImage"),
    turnTrackImage: document.getElementById("turnTrackImage"),
    missingDataTemplate: document.getElementById("missingDataTemplate"),
  };

  const app = {
    core: null,
    phaseFlow: null,
    menuModeSelection: null,
    mapZoom: null,
    mapZoomControlsUi: null,
    mapZoomPreference: "fit",
    mapZoomLevel: 1,
    mapZoomResizeTimer: null,
    mapZoomControlCleanups: [],
    mapZoomFitCancel: null,
    aiHeuristics: null,
    aiPhaseSearch: null,
    aiTactics: null,
    aiWeights: null,
    aiAlphaBrowser: null,
    aiAlpha: null,
    aiAlphaModelLoad: { status: "missing", value: null, reason: "model_missing" },
    aiHumanDemonstration: null,
    aiHumanDemonstrationAdapter: null,
    aiHumanRecorder: null,
    aiHumanCapture: null,
    aiHumanCaptureCodec: null,
    aiHumanCaptureStore: null,
    aiHumanRecovery: null,
    aiHumanCaptureWritable: true,
    aiHumanCapturePersistenceWritable: true,
    aiHumanCaptureIssue: null,
    aiAlphaAnalysisScheduler: null,
    aiAlphaGameAdapter: null,
    scenario: null,
    rules: null,
    board: null,
    hexes: [],
    hexById: new Map(),
    state: null,
    lang: localStorage.getItem(LANG_KEY) || "zh",
    reachable: new Map(),
    legalRetreats: new Set(),
    legalRetreatSteps: new Set(),
    retreatPaths: new Map(),
    neighborCache: new Map(),
    distanceCache: new Map(),
    focusedBattleId: null,
    animating: false,
    logExpanded: false,
    training: {
      sessionId: getTrainingSessionId(),
      entries: loadTrainingEntries(),
      events: loadTrainingEvents(),
    },
    ai: {
      mode: getSavedGameMode(),
      humanSide: humanSideForMode(getSavedGameMode()),
      running: false,
      scheduled: false,
      waitingForHuman: false,
      movementPlan: null,
    },
    online: {
      modules: null,
      selected: false,
      connecting: false,
      runtime: null,
      panel: null,
      unsubscribe: null,
      rulesetHash: null,
      lastAppliedRevision: null,
      submitting: false,
      hadRoom: false,
      setupStatus: null,
    },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function coreContext() {
    return {
      board: app.board,
      scenario: app.scenario,
      rules: app.rules,
      units: app.state.units,
      state: app.state,
    };
  }

  function aiSearchEnvironment(state = app.state) {
    if (!app.core?.createEnvironment || !state) return null;
    return app.core.createEnvironment({
      scenario: app.scenario,
      rules: app.rules,
      board: app.board,
      state,
    });
  }

  async function chooseAiAlphaAction(options = {}) {
    const chooseActionPath = app.aiAlphaBrowser?.chooseBrowserAlphaGameActionPath;
    if (typeof chooseActionPath !== "function") return null;
    const adapter = app.aiAlphaGameAdapter ?? null;
    const eventStateBefore = adapter !== null ? clone(app.state) : null;
    return chooseActionPath({
      adapter,
      adapterContext: { searchOptions: options },
      browserChooser: app.aiAlphaBrowser?.chooseBrowserAlphaAction,
      browserContext: {
        alpha: app.aiAlpha,
        scenario: app.scenario,
        rules: app.rules,
        state: app.state,
        side: activeSide(),
        legalActions: legalAlphaActions(),
        searchOptions: options,
        logger: console,
      },
      onRecommendation: adapter !== null
        ? (recommendation) => recordAlphaRecommendationEvent(recommendation, eventStateBefore)
        : null,
      logger: console,
    });
  }

  function legalAlphaActions(state = app.state) {
    const environment = aiSearchEnvironment(state);
    if (!environment || !app.core?.generateLegalActions) return [];
    try {
      return app.core.generateLegalActions(environment);
    } catch (error) {
      console.warn("Alpha AI legal action generation failed.", error);
      return [];
    }
  }

  function isLegalAlphaAction(action) {
    return Boolean(app.aiAlphaBrowser?.isBrowserAlphaActionLegal?.(action, legalAlphaActions()));
  }

  function recordAlphaRecommendationEvent(recommendation, stateBefore) {
    const alpha = app.aiAlphaBrowser?.summarizeBrowserAlphaGameRecommendation?.(recommendation);
    if (!alpha) return;
    recordTrainingEvent("ALPHA_ACTION_RECOMMENDED", stateBefore, {
      alpha,
      action: alpha.action,
      recommendationOk: alpha.ok,
      recommendationReason: alpha.reason,
      legalSelection: alpha.legalSelection,
    });
  }

  function alphaAssessmentSearchOptions() {
    return { ...AI_ALPHA_ANALYSIS_SEARCH };
  }

  function scheduleAlphaAssessment() {
    if (app.ai.mode === "hotseat" || isOnlineMatch()) return;
    if (!app.aiAlpha?.client?.analyze || !app.state || app.state.winner) return;
    if (app.animating || app.ai.running || el.body.dataset.view !== "game") return;
    if (app.aiAlphaGameAdapter?.request) {
      app.aiAlphaGameAdapter.request();
      return;
    }
    if (!app.aiAlphaAnalysisScheduler) return;
    app.aiAlphaAnalysisScheduler.request({
      alpha: app.aiAlpha,
      scenario: app.scenario,
      rules: app.rules,
      state: app.state,
      side: activeSide(),
      searchOptions: alphaAssessmentSearchOptions(),
      logger: console,
    });
  }

  function currentAlphaAssessmentCacheKey() {
    if (!app.aiAlphaBrowser?.browserAlphaAnalysisCacheKey || !app.aiAlphaBrowser?.buildBrowserAlphaSearchOptions) return null;
    if (!app.aiAlpha || !app.state || !app.scenario || !app.rules) return null;
    const side = activeSide();
    const searchOptions = app.aiAlphaBrowser.buildBrowserAlphaSearchOptions({
      model: app.aiAlpha.model,
      side,
      searchOptions: alphaAssessmentSearchOptions(),
    });
    return app.aiAlphaBrowser.browserAlphaAnalysisCacheKey({
      scenario: app.scenario,
      rules: app.rules,
      state: app.state,
      side,
      model: app.aiAlpha.model,
      searchOptions,
    });
  }

  function isAlphaAssessmentSummaryCurrent() {
    if (!app.aiAlpha?.lastSummary) return false;
    const summaryKey = app.aiAlpha.lastAnalysisMeta?.cacheKey;
    const currentKey = currentAlphaAssessmentCacheKey();
    return Boolean(summaryKey && currentKey && summaryKey === currentKey);
  }

  function isAlphaAdapterSnapshotCurrent(snapshot = app.aiAlphaGameAdapter?.lastSnapshot) {
    if (!snapshot || !isAlphaAssessmentSummaryCurrent()) return false;
    const summaryHash = app.aiAlpha?.lastSummary?.stateHash || null;
    return !summaryHash || !snapshot.stateHash || snapshot.stateHash === summaryHash;
  }

  function currentAlphaBestAction() {
    const snapshot = app.aiAlphaGameAdapter?.lastSnapshot;
    const adapterAction = isAlphaAdapterSnapshotCurrent(snapshot) && snapshot?.action?.canApply
      ? snapshot.action.selected
      : null;
    if (isLegalAlphaAction(adapterAction)) return adapterAction;
    const action = isAlphaAssessmentSummaryCurrent() ? app.aiAlpha.lastSummary?.bestAction || null : null;
    return isLegalAlphaAction(action) ? action : null;
  }

  function getSavedGameMode() {
    const savedMode = localStorage.getItem(AI_GAME_MODE_KEY);
    if (["axis-vs-ai", "allied-vs-ai", "hotseat"].includes(savedMode)) return savedMode;
    return localStorage.getItem(AI_HUMAN_SIDE_KEY) === "allied" ? "allied-vs-ai" : "axis-vs-ai";
  }

  function humanSideForMode(mode) {
    if (mode === "allied-vs-ai") return "allied";
    return "axis";
  }

  function tr(key, params = {}) {
    const table = I18N[app.lang] || I18N.zh;
    const value = key.split(".").reduce((node, part) => node?.[part], table) ?? key;
    return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
  }

  function onlinePanelLabels() {
    const keys = [
      "title",
      "roomCode",
      "axis",
      "allied",
      "create",
      "join",
      "ready",
      "notReady",
      "reconnect",
      "leave",
      "offline",
      "connecting",
      "connected",
      "disconnected",
      "error",
      "lobby",
      "active",
      "finished",
      "abandoned",
      "expired",
      "empty",
      "occupied",
    ];
    return Object.fromEntries(keys.map((key) => [key, tr(`online.panel.${key}`)]));
  }

  function phase() {
    return app.rules.phases[app.state.phaseIndex];
  }

  function activeSide() {
    return phase().side;
  }

  function enemySide(side) {
    return OPPOSITE_SIDE[side];
  }

  function unitById(id) {
    return app.state.units.find((unit) => unit.id === id);
  }

  function hexById(id) {
    return app.hexById.get(id);
  }

  function terrainRule(hex) {
    return app.rules.terrain[hex?.terrain] || app.rules.terrain.desert;
  }

  function liveUnits() {
    return app.state.units.filter((unit) => !unit.eliminated);
  }

  function liveUnitsAt(hexId) {
    return liveUnits().filter((unit) => unit.hexId === hexId);
  }

  function liveUnitAt(hexId) {
    return liveUnitsAt(hexId)[0] || null;
  }

  function isCombatPhase() {
    return phase().type === "combat";
  }

  function isMovementPhase() {
    return phase().type === "movement";
  }

  function sideLabel(side) {
    return tr(`side.${side}`);
  }

  function nationalityLabel(nationality) {
    return tr(`nationality.${nationality}`);
  }

  function phaseLabel(id) {
    return tr(`phase.${id}`);
  }

  function unitName(unit) {
    if (!unit) return "--";
    return app.lang === "en" ? (UNIT_EN[unit.id] || unit.name) : unit.name;
  }

  function hexLabel(hexId) {
    const hex = hexById(hexId);
    if (!hex) return "--";
    const row = String(hex.row + 1).padStart(2, "0");
    const col = String(27 - hex.col).padStart(2, "0");
    return `${row}${col}`;
  }

  function log(message) {
    app.state.log.push(`[T${app.state.turn}] ${message}`);
    if (app.state.log.length > 180) app.state.log.shift();
  }

  function getTrainingSessionId() {
    const existing = localStorage.getItem(TRAINING_SESSION_KEY);
    if (existing) return existing;
    const next = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(TRAINING_SESSION_KEY, next);
    return next;
  }

  function loadTrainingEntries() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRAINING_LOG_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-TRAINING_LOG_LIMIT) : [];
    } catch (_) {
      return [];
    }
  }

  function loadTrainingEvents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRAINING_EVENT_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-TRAINING_EVENT_LIMIT) : [];
    } catch (_) {
      return [];
    }
  }

  function saveTrainingEntries() {
    app.training.entries = app.training.entries.slice(-TRAINING_LOG_LIMIT);
    try {
      localStorage.setItem(TRAINING_LOG_KEY, JSON.stringify(app.training.entries));
    } catch (_) {
      app.training.entries = app.training.entries.slice(-Math.floor(TRAINING_LOG_LIMIT / 2));
      try {
        localStorage.setItem(TRAINING_LOG_KEY, JSON.stringify(app.training.entries));
      } catch {
        app.training.entries = [];
      }
    }
  }

  function saveTrainingEvents() {
    app.training.events = app.training.events.slice(-TRAINING_EVENT_LIMIT);
    try {
      localStorage.setItem(TRAINING_EVENT_KEY, JSON.stringify(app.training.events));
    } catch (_) {
      app.training.events = app.training.events.slice(-Math.floor(TRAINING_EVENT_LIMIT / 2));
      try {
        localStorage.setItem(TRAINING_EVENT_KEY, JSON.stringify(app.training.events));
      } catch {
        app.training.events = [];
      }
    }
  }

  function isHumanControlledSide(side) {
    return app.ai.mode === "hotseat" || app.ai.humanSide === side;
  }

  function shouldRecordTraining(side = activeSide()) {
    return Boolean(app.state && !app.state.winner && isHumanControlledSide(side));
  }

  function recordTrainingEntry(entry) {
    if (!entry) return;
    app.training.entries.push({
      id: `sample-${Date.now().toString(36)}-${app.training.entries.length}`,
      createdAt: new Date().toISOString(),
      sessionId: app.training.sessionId,
      mode: app.ai.mode,
      turn: app.state.turn,
      phaseId: phase().id,
      phaseIndex: app.state.phaseIndex,
      side: activeSide(),
      stateHash: trainingStateHash(),
      ...entry,
    });
    saveTrainingEntries();
  }

  function recordTrainingEvent(type, stateBefore = null, details = {}) {
    if (!type || !app.state || !app.core?.createEnvironment) return;
    const beforeSnapshot = stateBefore ? trainingStateSnapshot(stateBefore) : null;
    const afterSnapshot = trainingStateSnapshot(app.state);
    const beforeEnvironment = stateBefore ? trainingEnvironmentForState(stateBefore) : null;
    const afterEnvironment = trainingEnvironmentForState(app.state);
    const event = {
      schema: "zizi-el-alamein-replay-event-v1",
      id: `event-${Date.now().toString(36)}-${app.training.events.length}`,
      createdAt: new Date().toISOString(),
      sessionId: app.training.sessionId,
      mode: app.ai.mode,
      type,
      turn: app.state.turn,
      phaseId: phase()?.id || null,
      phaseIndex: app.state.phaseIndex,
      side: activeSide(),
      stateHashBefore: beforeEnvironment ? app.core.stateHash(beforeEnvironment) : null,
      stateHashAfter: app.core.stateHash(afterEnvironment),
      legalActionsBefore: beforeEnvironment ? safeTrainingLegalActions(beforeEnvironment) : [],
      legalActionsAfter: safeTrainingLegalActions(afterEnvironment),
      metricsBefore: beforeEnvironment ? safeTrainingMetrics(beforeEnvironment) : null,
      metricsAfter: safeTrainingMetrics(afterEnvironment),
      stateBefore: beforeSnapshot,
      stateAfter: afterSnapshot,
      ...details,
    };
    app.training.events.push(event);
    saveTrainingEvents();
  }

  function trainingEnvironmentForState(state) {
    return app.core.createEnvironment({
      scenario: app.scenario,
      rules: app.rules,
      board: app.board,
      state,
    });
  }

  function safeTrainingLegalActions(environment) {
    try {
      return app.core.generateLegalActions(environment, { includeChanceActions: true }).map(app.core.compactAction);
    } catch (error) {
      return [{ type: "ERROR", reason: "legal_action_generation_failed", message: String(error?.message || error) }];
    }
  }

  function safeTrainingMetrics(environment) {
    try {
      return app.core.environmentMetrics(environment);
    } catch (error) {
      return { error: "metrics_generation_failed", message: String(error?.message || error) };
    }
  }

  function trainingStateSnapshot(state) {
    return {
      version: state.version || 2,
      turn: state.turn,
      phaseIndex: state.phaseIndex,
      phaseId: app.rules?.phases?.[state.phaseIndex]?.id || null,
      combatMode: state.combatMode || "declare",
      movedUnits: (state.movedUnits || []).slice(),
      usedAttackers: (state.usedAttackers || []).slice(),
      usedDefenders: (state.usedDefenders || []).slice(),
      declaredCombats: (state.declaredCombats || []).map((battle) => ({
        id: battle.id,
        turn: battle.turn,
        phaseId: battle.phaseId,
        side: battle.side,
        defenderId: battle.defenderId,
        defenderHexId: battle.defenderHexId,
        attackerIds: (battle.attackerIds || []).slice(),
        attackerOrigins: clone(battle.attackerOrigins || {}),
        attackerHexIds: (battle.attackerHexIds || []).slice(),
        oddsShort: battle.oddsShort || null,
        roll: battle.roll || null,
        result: battle.resultCode || battle.result || null,
        resolved: Boolean(battle.resolved),
      })),
      retreatTask: state.retreatTask ? {
        battleId: state.retreatTask.battleId || null,
        unitIds: (state.retreatTask.unitIds || []).slice(),
        index: state.retreatTask.index || 0,
        steps: state.retreatTask.steps,
        result: state.retreatTask.result,
        origins: clone(state.retreatTask.origins || {}),
        controllerSide: state.retreatTask.controllerSide || null,
        disruptAfterRetreat: Boolean(state.retreatTask.disruptAfterRetreat),
        advanceAfter: Boolean(state.retreatTask.advanceAfter),
      } : null,
      advanceTask: state.advanceTask ? {
        battleId: state.advanceTask.battleId,
        targetHexId: state.advanceTask.targetHexId,
        attackerIds: (state.advanceTask.attackerIds || []).slice(),
      } : null,
      winner: state.winner ? {
        side: state.winner.side,
        reason: state.winner.reason,
        type: state.winner.type || null,
        turn: state.winner.turn || state.turn,
      } : null,
      eliminatedUnitIds: (state.eliminatedUnitIds || []).slice(),
      losses: clone(state.losses || makeStats()),
      units: (state.units || []).map((unit) => ({
        id: unit.id,
        side: unit.side,
        combat: Number(unit.combat || 0),
        movement: Number(unit.movement || 0),
        hexId: unit.hexId,
        disrupted: Boolean(unit.disrupted),
        eliminated: Boolean(unit.eliminated),
      })),
    };
  }

  function recordGameStartedEvents() {
    recordTrainingEvent("GAME_STARTED", null, {
      phaseStarted: phase()?.id || null,
    });
    recordTrainingEvent("PHASE_STARTED", app.state, {
      phaseId: phase()?.id || null,
      turn: app.state.turn,
    });
  }

  function recordGameEndedEvent(stateBefore, details = {}) {
    if (!app.state?.winner) return;
    recordTrainingEvent("GAME_ENDED", stateBefore, {
      winner: {
        side: app.state.winner.side,
        reason: app.state.winner.reason,
        type: app.state.winner.type || null,
        turn: app.state.winner.turn || app.state.turn,
      },
      ...details,
    });
  }

  function trainingStateHash() {
    const payload = liveUnits()
      .map((unit) => `${unit.id}:${unit.hexId}:${unit.disrupted ? 1 : 0}`)
      .sort()
      .join("|");
    let hash = 2166136261;
    const text = `${app.state.turn}:${app.state.phaseIndex}:${payload}`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function unitTrainingSnapshot(unit) {
    if (!unit) return null;
    return {
      id: unit.id,
      side: unit.side,
      combat: Number(unit.combat || 0),
      movement: Number(unit.movement || 0),
      hexId: unit.hexId,
      hex: hexLabel(unit.hexId),
      disrupted: Boolean(unit.disrupted),
    };
  }

  function routeTrainingSnapshot(route) {
    if (!route) return null;
    return {
      remaining: Number(route.remaining || 0),
      path: route.path ? route.path.slice() : [],
      pathLabels: route.path ? route.path.map(hexLabel) : [],
    };
  }

  function scoredMoveChoice(unit, hexId, route, scoreContext) {
    const score = scoreAiHex(unit, hexId, route, scoreContext) + roughAiMoveScore(unit, hexId, route) * 0.06;
    return {
      hexId,
      hex: hexLabel(hexId),
      score: Number(score.toFixed(2)),
      route: routeTrainingSnapshot(route),
    };
  }

  function movementTrainingEntry(unit, fromHexId, destinationHexId, route, reachable) {
    if (!shouldRecordTraining(unit.side)) return null;
    const previousPlan = app.ai.movementPlan;
    const operationalPlan = buildAiOperationalPlan(unit.side);
    const scoreContext = {
      operationalPlan,
      axisCurrentOvermass: unit.side === "axis" ? axisLocalAttackOvermassScore(unit, unit.hexId) : 0,
    };
    app.ai.movementPlan = operationalPlan;
    try {
      const ranked = Array.from(reachable.entries())
        .map(([hexId, candidateRoute]) => scoredMoveChoice(unit, hexId, candidateRoute, scoreContext))
        .sort((a, b) => b.score - a.score || String(a.hexId).localeCompare(String(b.hexId)));
      const humanChoice = scoredMoveChoice(unit, destinationHexId, route, scoreContext);
      const aiChoice = ranked[0] || null;
      return {
        action: "move",
        unit: unitTrainingSnapshot(unit),
        fromHexId,
        fromHex: hexLabel(fromHexId),
        humanChoice,
        aiChoice,
        aiTopChoices: ranked.slice(0, 5),
        legalChoiceCount: ranked.length,
        scoreDelta: aiChoice ? Number((humanChoice.score - aiChoice.score).toFixed(2)) : 0,
      };
    } finally {
      app.ai.movementPlan = previousPlan;
    }
  }

  function combatTrainingEntry(attackers, defender, odds) {
    if (!shouldRecordTraining(activeSide())) return null;
    const best = bestAiCombatCandidate();
    const humanScore = scoreAiCombat(attackers, defender, odds);
    return {
      action: "combat-declaration",
      defender: unitTrainingSnapshot(defender),
      attackers: attackers.map(unitTrainingSnapshot),
      humanChoice: {
        defenderId: defender.id,
        defenderHexId: defender.hexId,
        defenderHex: hexLabel(defender.hexId),
        attackerIds: attackers.map((unit) => unit.id),
        attackerHexIds: attackers.map((unit) => unit.hexId),
        odds: formatOdds(odds),
        score: Number(humanScore.toFixed(2)),
      },
      aiChoice: best ? {
        defenderId: best.defender.id,
        defenderHexId: best.defender.hexId,
        defenderHex: hexLabel(best.defender.hexId),
        attackerIds: best.attackers.map((unit) => unit.id),
        attackerHexIds: best.attackers.map((unit) => unit.hexId),
        odds: formatOdds(best.odds),
        score: Number(best.score.toFixed(2)),
      } : null,
      scoreDelta: best ? Number((humanScore - best.score).toFixed(2)) : 0,
    };
  }

  function retreatTrainingEntry(unit, hexId, path) {
    const controllerSide = retreatControllerSide();
    if (!shouldRecordTraining(controllerSide)) return null;
    const aiHexId = chooseAiRetreatDestination(unit);
    return {
      action: "retreat",
      controllerSide,
      battleId: app.state.retreatTask?.battleId || null,
      unit: unitTrainingSnapshot(unit),
      humanChoice: {
        hexId,
        hex: hexLabel(hexId),
        route: routeTrainingSnapshot({ path, remaining: 0 }),
      },
      aiChoice: aiHexId ? {
        hexId: aiHexId,
        hex: hexLabel(aiHexId),
        route: routeTrainingSnapshot({ path: app.retreatPaths.get(aiHexId) || [], remaining: 0 }),
      } : null,
      legalChoiceCount: app.retreatPaths.size,
    };
  }

  function advanceTrainingEntry(unitId) {
    const task = app.state.advanceTask;
    const controllerSide = activeSide();
    if (!task || !shouldRecordTraining(controllerSide)) return null;
    const aiUnitId = chooseAiAdvanceUnit() || "skip";
    const unit = unitId === "skip" ? null : unitById(unitId);
    const aiUnit = aiUnitId === "skip" ? null : unitById(aiUnitId);
    return {
      action: "advance",
      battleId: task.battleId,
      targetHexId: task.targetHexId,
      targetHex: hexLabel(task.targetHexId),
      eligibleUnitIds: task.attackerIds.slice(),
      humanChoice: unit ? unitTrainingSnapshot(unit) : { id: "skip" },
      aiChoice: aiUnit ? unitTrainingSnapshot(aiUnit) : { id: "skip" },
    };
  }

  function exportTrainingEntries() {
    const payload = {
      schema: "zizi-el-alamein-training-log-v2",
      exportedAt: new Date().toISOString(),
      sessionId: app.training.sessionId,
      entries: app.training.entries,
      events: app.training.events,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `el-alamein-training-${app.training.sessionId}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clearTrainingEntries() {
    app.training.entries = [];
    app.training.events = [];
    localStorage.removeItem(TRAINING_LOG_KEY);
    localStorage.removeItem(TRAINING_EVENT_KEY);
    draw();
  }

  function createHumanDemonstrationAdapter({ environmentAdapterModule, trainingModule, fingerprintModule }) {
    const coreAdapter = environmentAdapterModule.createElAlameinAlphaEnvironmentAdapter({
      scenario: app.scenario,
      rules: app.rules,
      board: app.board,
    });
    const featureContract = trainingModule.alphaTrainingFeatureContract();
    const fingerprints = {
      scenario: fingerprintModule.canonicalSha256(app.scenario, "El Alamein human demonstration scenario"),
      rules: fingerprintModule.canonicalSha256(app.rules, "El Alamein human demonstration rules"),
      features: fingerprintModule.canonicalSha256(featureContract, "El Alamein human demonstration features"),
    };
    const adapter = {
      id: "el-alamein",
      version: "2.0",
      factionIds: coreAdapter.players,
      featureContract,
      verifyDecision(state) {
        const metadata = coreAdapter.metadata(state);
        return {
          stateHash: coreAdapter.stateHash(state),
          turn: metadata.turn,
          phase: metadata.phase,
          side: coreAdapter.currentPlayer(state),
          legalActions: coreAdapter.legalActions(state).map((entry) => entry.action),
        };
      },
      getTerminalResult(state) {
        const terminal = coreAdapter.terminalResult(state);
        if (!terminal) return null;
        return {
          winnerId: terminal.winnerId,
          stateHash: coreAdapter.stateHash(state),
          stateFingerprint: app.aiHumanDemonstration.canonicalHumanStateFingerprint(state),
        };
      },
      verifyTerminalEvidence(evidence) {
        return this.getTerminalResult(evidence.finalStateSnapshot);
      },
      featuresForState(state, side) {
        const environment = app.core.createEnvironment({
          scenario: app.scenario,
          rules: app.rules,
          board: app.board,
          state,
        });
        const metrics = app.core.environmentMetrics(environment);
        const enemy = side === "axis" ? "allied" : "axis";
        const maxTurn = Math.max(1, (app.rules.turns || []).length - 1);
        return {
          turnProgress: Math.max(0, Math.min(1, (Number(state.turn || 1) - 1) / maxTurn)),
          materialBalance: Number(metrics.combatStrength?.[side] || 0) - Number(metrics.combatStrength?.[enemy] || 0),
          unitBalance: Number(metrics.unitCount?.[side] || 0) - Number(metrics.unitCount?.[enemy] || 0),
          axisObjectiveHeld: metrics.objectiveStatus?.ridgeFullControl || metrics.objectiveStatus?.elAlameinOccupied ? 1 : 0,
          alliedBreakthroughReady: side === "allied" && Boolean(metrics.objectiveStatus?.alliedBreakthroughReady) ? 1 : 0,
        };
      },
    };
    return {
      adapter,
      fingerprints,
      now: () => new Date().toISOString(),
      createId: (kind, sequence) => `${kind}-${app.training.sessionId}-${sequence}`,
    };
  }

  function loadHumanDemonstrationRecording() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HUMAN_DEMONSTRATION_RECORDING_KEY) || "null");
      const recording = parsed && app.aiHumanCaptureCodec
        ? app.aiHumanCaptureCodec.decode(parsed)
        : parsed;
      return recording?.schema === app.aiHumanDemonstration?.HUMAN_DEMONSTRATION_RECORDING_SCHEMA
        ? recording
        : null;
    } catch (_) {
      return null;
    }
  }

  function persistHumanDemonstrationRecording(recording) {
    if (!app.aiHumanCapturePersistenceWritable) {
      renderHumanLabRecoveryUi();
      return false;
    }
    try {
      if (!recording) localStorage.removeItem(HUMAN_DEMONSTRATION_RECORDING_KEY);
      else {
        const persisted = app.aiHumanCaptureCodec
          ? app.aiHumanCaptureCodec.encode(recording)
          : recording;
        localStorage.setItem(HUMAN_DEMONSTRATION_RECORDING_KEY, JSON.stringify(persisted));
      }
      renderHumanLabRecoveryUi();
      return true;
    } catch (error) {
      console.warn("Human-demonstration recording could not be persisted.", error);
      setHumanLabCaptureIssue(app.aiHumanCapture?.humanLabStorageFailureReason(error) || "storage_write_failed");
      return false;
    }
  }

  function startHumanDemonstrationRecording() {
    if (!app.aiHumanRecorder) return;
    app.aiHumanCaptureWritable = true;
    app.aiHumanCapturePersistenceWritable = true;
    app.aiHumanCaptureIssue = null;
    const suffix = Date.now().toString(36);
    const result = app.aiHumanRecorder.start({
      datasetId: `human-demo-${app.training.sessionId}-${suffix}`,
      gameId: `game-${app.training.sessionId}-${suffix}`,
      generatedAt: new Date().toISOString(),
    });
    renderHumanLabRecoveryUi();
    return result;
  }

  function currentHumanLabRecoveryState() {
    return app.aiHumanRecovery?.humanLabRecordingRecoveryState(app.aiHumanRecorder?.getRecording()) || {
      canExport: false,
      decisionCount: 0,
      gameStatus: null,
    };
  }

  function setHumanLabCaptureIssue(reason) {
    const normalizedReason = String(reason || "capture_failed");
    const policy = app.aiHumanCapture?.humanLabCaptureIssuePolicy?.(normalizedReason) || {
      captureWritable: false,
      persistenceWritable: false,
    };
    app.aiHumanCaptureWritable = policy.captureWritable;
    app.aiHumanCapturePersistenceWritable = policy.persistenceWritable;
    app.aiHumanCaptureIssue = normalizedReason;
    renderHumanLabRecoveryUi();
  }

  function renderHumanLabRecoveryUi() {
    if (!el.menuExportHumanDemonstrationButton || !el.humanLabMenuStatus || !el.humanLabGameStatus) return;
    const enabled = Boolean(PRODUCT_PROFILE.features.humanLabCaptureIntegrity);
    const recovery = currentHumanLabRecoveryState();
    el.menuExportHumanDemonstrationButton.hidden = !enabled;
    el.menuExportHumanDemonstrationButton.disabled = !recovery.canExport;
    if (el.exportHumanDemonstrationButton) el.exportHumanDemonstrationButton.disabled = !recovery.canExport;
    const issuePolicy = app.aiHumanCaptureIssue
      ? app.aiHumanCapture?.humanLabCaptureIssuePolicy?.(app.aiHumanCaptureIssue)
      : null;
    const issueMessage = issuePolicy?.captureWritable
      ? tr("ui.humanLabPersistenceDegraded")
      : tr("ui.humanLabCapturePaused");
    const menuMessage = app.aiHumanCaptureIssue
      ? issueMessage
      : recovery.canExport
        ? tr("ui.humanLabRecoveryAvailable", { count: recovery.decisionCount })
        : "";
    const gameMessage = app.aiHumanCaptureIssue ? issueMessage : "";
    el.humanLabMenuStatus.textContent = menuMessage;
    el.humanLabMenuStatus.hidden = !enabled || !menuMessage;
    el.humanLabGameStatus.textContent = gameMessage;
    el.humanLabGameStatus.hidden = !enabled || !gameMessage;
  }

  function humanDemonstrationStateHash(state = app.state) {
    if (!state || !app.aiHumanDemonstrationAdapter) return null;
    try {
      return app.aiHumanDemonstrationAdapter.verifyDecision(trainingStateSnapshot(state))?.stateHash || null;
    } catch (_) {
      return null;
    }
  }

  function archiveHumanDemonstrationRecording(reason, state = app.state) {
    const recording = app.aiHumanRecorder?.getRecording();
    if (!recording?.decisions?.length || !app.aiHumanCaptureStore) return true;
    if (!app.aiHumanCapturePersistenceWritable) return false;
    try {
      const result = app.aiHumanCaptureStore.archiveRecording(recording, {
        reason,
        stateHash: humanDemonstrationStateHash(state),
      });
      if (result.status === "storage_failed") {
        setHumanLabCaptureIssue(result.reason);
        return false;
      }
      return true;
    } catch (error) {
      console.warn("Human-lab recording archive failed closed.", error);
      setHumanLabCaptureIssue("archive_failed");
      return false;
    }
  }

  function checkpointHumanDemonstration(slot, lifecycleType, state = app.state) {
    if (!app.aiHumanRecorder || !app.aiHumanCaptureStore || !state) return false;
    const stateHash = humanDemonstrationStateHash(state);
    if (!stateHash) return false;
    try {
      const recording = app.aiHumanRecorder.getRecording();
      if (recording?.game?.status === "incomplete") {
        app.aiHumanRecorder.recordLifecycle({ type: lifecycleType, stateHash, details: { slot } });
      }
      if (!app.aiHumanCapturePersistenceWritable) return false;
      const result = app.aiHumanCaptureStore.writeCheckpoint(slot, {
        stateHash,
        recording: app.aiHumanRecorder.getRecording(),
      });
      if (result.status === "storage_failed") {
        setHumanLabCaptureIssue(result.reason);
        return false;
      }
      return true;
    } catch (error) {
      console.warn("Human-lab recording checkpoint failed closed.", error);
      setHumanLabCaptureIssue("checkpoint_failed");
      return false;
    }
  }

  function restoreHumanDemonstrationCheckpoint(slot, state) {
    if (!app.aiHumanRecorder || !app.aiHumanCaptureStore) return "unavailable";
    const stateHash = humanDemonstrationStateHash(state);
    if (!stateHash) return "state_unavailable";
    try {
      const result = app.aiHumanCaptureStore.readCheckpoint(slot, stateHash);
      if (result.status === "matched") {
        app.aiHumanRecorder.restore(result.recording);
        if (result.recording.game?.status === "incomplete") {
          app.aiHumanRecorder.recordLifecycle({ type: "RECORDING_RESTORED", stateHash, details: { slot } });
        }
        return "restored";
      }
      if (!archiveHumanDemonstrationRecording(`restore_${result.status}`, app.state)) return "archive_failed";
      startHumanDemonstrationRecording();
      app.aiHumanRecorder.recordLifecycle({
        type: "RECORDING_REBUILT",
        stateHash,
        details: { slot, reason: result.status },
      });
      return "rebuilt";
    } catch (error) {
      console.warn("Human-lab recording restore failed closed.", error);
      return "restore_failed";
    }
  }

  function applyHumanLabContinuationPolicy(captureStatus) {
    const policy = app.aiHumanRecovery?.humanLabContinuationPolicy(captureStatus);
    if (!policy) return { allowContinuation: true, captureWritable: true, requiresExport: false, reason: null };
    if (!policy.captureWritable) {
      app.aiHumanCaptureWritable = false;
      app.aiHumanCapturePersistenceWritable = false;
      if (policy.requiresExport) setHumanLabCaptureIssue(policy.reason);
    } else if (!app.aiHumanCaptureIssue) {
      app.aiHumanCaptureWritable = true;
      app.aiHumanCapturePersistenceWritable = true;
    }
    return policy;
  }

  function shouldProtectHumanDemonstrationRecording() {
    return Boolean(app.aiHumanCapture?.shouldProtectUnexportedHumanLabRecording(
      app.aiHumanRecorder?.getRecording(),
    ));
  }

  function prepareHumanDemonstrationForNewGame() {
    if (!shouldProtectHumanDemonstrationRecording()) return true;
    if (!window.confirm(tr("ui.confirmUnexportedHumanDemonstrationNewGame"))) {
      return false;
    }
    return archiveHumanDemonstrationRecording("new_game");
  }

  function protectUnexportedHumanDemonstrationOnLeave(event) {
    if (!shouldProtectHumanDemonstrationRecording()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function humanDemonstrationPlayer(side) {
    return {
      sourceId: `human:${side}`,
      participantId: app.aiHumanDemonstration.anonymousHumanParticipantId(`${app.training.sessionId}:${side}`),
      metadata: {
        consentVersion: "local-v1",
        sourceCohort: "local-browser",
      },
    };
  }

  function recordHumanDemonstrationDecision(action, stateBefore = app.state, options = {}) {
    if (!app.aiHumanRecorder || !app.aiHumanCaptureWritable || !stateBefore || stateBefore.winner) return false;
    const snapshot = trainingStateSnapshot(stateBefore);
    const facts = app.aiHumanDemonstrationAdapter?.verifyDecision(snapshot);
    if (!facts) return false;
    const side = options.side || facts.side;
    if (!side || !isHumanControlledSide(side)) return false;
    const compact = app.core.compactAction(action);
    const legalActions = (facts.legalActions || []).map((entry) => app.core.compactAction(entry));
    const chosenKey = app.aiHumanDemonstration.canonicalHumanActionKey(compact);
    const isLegal = legalActions.some((entry) => (
      app.aiHumanDemonstration.canonicalHumanActionKey(entry) === chosenKey
    ));
    if (!isLegal) return false;
    return app.aiHumanRecorder.recordDecision({
      playerSourceId: humanDemonstrationPlayer(side).sourceId,
      turn: facts.turn,
      phase: facts.phase,
      side,
      stateHash: facts.stateHash,
      stateSnapshot: snapshot,
      legalActions,
      chosenAction: compact,
      expertBestAction: null,
      rankedAlternatives: [],
      confidence: null,
      intent: null,
      turnDoctrineTags: [],
    }, humanDemonstrationPlayer(side));
  }

  function completeHumanDemonstrationRecording() {
    if (!app.aiHumanRecorder || !app.state?.winner) return;
    try {
      app.aiHumanRecorder.complete(trainingStateSnapshot(app.state));
    } catch (error) {
      console.warn("Human-demonstration terminal recording failed.", error);
    }
  }

  function exportHumanDemonstration() {
    if (!app.aiHumanRecorder || !app.aiHumanDemonstration) return;
    const recording = app.aiHumanRecorder.getRecording();
    const decisionCount = Array.isArray(recording?.decisions) ? recording.decisions.length : 0;
    if (decisionCount === 0) return;
    try {
      const readiness = app.aiHumanCapture?.humanLabStandardExportReadiness(recording, {
        captureIssue: app.aiHumanCaptureIssue,
        expectedHumanSides: app.ai.mode === "hotseat"
          ? ["axis", "allied"]
          : [app.ai.humanSide].filter(Boolean),
      }) || { ready: true, reason: null };
      if (!readiness.ready) throw new Error(readiness.reason);
      const dataset = app.aiHumanRecorder.buildDataset();
      const captureIntegrityEnabled = PRODUCT_PROFILE.features.humanLabCaptureIntegrity;
      const text = captureIntegrityEnabled
        ? app.aiHumanDemonstration.serializeHumanDemonstrationCaptureBundle(recording, dataset)
        : app.aiHumanDemonstration.serializeHumanDemonstrationDataset(dataset);
      downloadHumanLabJson(
        text,
        captureIntegrityEnabled
          ? `el-alamein-human-capture-${dataset.datasetId}.json`
          : `el-alamein-human-demonstration-${dataset.datasetId}.json`,
      );
      if (captureIntegrityEnabled) app.aiHumanRecorder.markExported(dataset.fingerprint);
      log(tr("text.humanDemonstrationExported", { count: dataset.decisions.length }));
      setMenuStatus(tr("text.humanDemonstrationExported", { count: dataset.decisions.length }));
    } catch (error) {
      console.warn("Human-demonstration export failed.", error);
      try {
        const exportedAt = new Date().toISOString();
        const text = app.aiHumanCapture?.serializeHumanLabRecoveryExport(recording, {
          exportedAt,
          reason: String(error?.message || "dataset_build_failed"),
        });
        if (!text) throw error;
        downloadHumanLabJson(text, `el-alamein-human-recovery-${recording.datasetId || Date.now()}.json`);
        const acknowledged = app.aiHumanCapture?.acknowledgeHumanLabRecoveryExport(recording, { exportedAt });
        if (acknowledged) app.aiHumanRecorder.restore(acknowledged);
        const message = tr("text.humanDemonstrationRecoveryExported", { count: decisionCount });
        log(message);
        setMenuStatus(message);
      } catch (recoveryError) {
        const message = tr("text.humanDemonstrationExportFailed", {
          reason: String(recoveryError?.message || recoveryError),
        });
        log(message);
        setMenuStatus(message);
      }
    }
    renderHumanLabRecoveryUi();
    draw();
  }

  function downloadHumanLabJson(text, filename) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function makeStats() {
    return {
      axis: { units: 0, combat: 0 },
      allied: { units: 0, combat: 0 },
    };
  }

  function totalStrengthBySide(units) {
    return units.reduce((totals, unit) => {
      if (!unit.eliminated) totals[unit.side] += Number(unit.combat || 0);
      return totals;
    }, { axis: 0, allied: 0 });
  }

  function makeInitialState() {
    const units = clone(app.scenario.units);
    return {
      version: 2,
      turn: 1,
      phaseIndex: 0,
      selectedUnitId: null,
      selectedDefenderId: null,
      selectedAttackers: [],
      combatMode: "declare",
      declaredCombats: [],
      combatCompleteNotified: false,
      movedUnits: [],
      usedAttackers: [],
      usedDefenders: [],
      lastMove: null,
      retreatTask: null,
      advanceTask: null,
      lastCombatResult: null,
      battleReports: [],
      eliminatedUnitIds: [],
      losses: makeStats(),
      initialStrength: totalStrengthBySide(units),
      log: [tr("text.newGame")],
      winner: null,
      units,
    };
  }

  function normalizeState(state, options = {}) {
    if (!state || !Array.isArray(state.units)) throw new Error("Bad state");
    const preserveTransient = Boolean(options.preserveTransient);
    state.version = 2;
    state.selectedAttackers ||= [];
    state.declaredCombats ||= [];
    state.movedUnits ||= [];
    state.usedAttackers ||= [];
    state.usedDefenders ||= [];
    state.log ||= [];
    state.combatMode ||= "declare";
    state.battleReports ||= [];
    state.eliminatedUnitIds ||= [];
    state.losses ||= makeStats();
    state.initialStrength ||= totalStrengthBySide(app.scenario?.units || state.units);
    state.lastCombatResult ||= null;
    if (!preserveTransient) {
      state.selectedUnitId = null;
      state.selectedDefenderId = null;
      state.selectedAttackers = [];
      state.lastMove = null;
      state.retreatTask = null;
      state.advanceTask = null;
    } else {
      state.selectedUnitId ||= null;
      state.selectedDefenderId ||= null;
      state.lastMove ||= null;
      state.retreatTask ||= null;
      state.advanceTask ||= null;
    }
    return state;
  }

  async function init() {
    try {
      const [
        core,
        phaseFlow,
        menuModeSelection,
        mapZoom,
        mapZoomControlsUi,
        aiHeuristics,
        aiPhaseSearch,
        aiTactics,
        aiAlphaBrowser,
        aiAlphaPreview,
        aiHumanDemonstration,
        aiHumanCapture,
        aiHumanRecovery,
        aiAlphaEnvironmentAdapter,
        aiAlphaTraining,
        alphaFingerprint,
        onlineModules,
        scenario,
        rules,
        aiWeights,
        normalAiAlphaModelLoad,
      ] = await Promise.all([
        coreRulesPromise,
        phaseFlowPromise,
        menuModeSelectionPromise,
        mapZoomPromise,
        mapZoomControlsPromise,
        aiHeuristicsPromise,
        aiPhaseSearchPromise,
        aiTacticsPromise,
        aiAlphaBrowserPromise,
        aiAlphaPreviewPromise,
        aiHumanDemonstrationPromise,
        aiHumanCapturePromise,
        aiHumanRecoveryPromise,
        aiAlphaEnvironmentAdapterPromise,
        aiAlphaTrainingPromise,
        alphaFingerprintPromise,
        onlineModulesPromise,
        fetchJson("local-data/scenario.json"),
        fetchJson("local-data/rules.json"),
        fetchJson("local-data/ai-weights-expert.json").catch(() => null),
        PRODUCT_PROFILE.features.alphaRuntime
          ? fetchOptionalJson("local-data/alpha-model.json")
          : Promise.resolve({ status: "missing", value: null, reason: "profile_disabled" }),
      ]);
      app.core = core;
      app.phaseFlow = phaseFlow;
      app.menuModeSelection = menuModeSelection;
      app.mapZoom = mapZoom;
      app.mapZoomControlsUi = mapZoomControlsUi;
      app.mapZoomPreference = app.mapZoom.readMapZoomPreference(
        localStorage,
        PRODUCT_PROFILE.storage.mapZoomStorageKey,
      );
      app.mapZoomLevel = app.mapZoomPreference === app.mapZoom.FIT_MAP_ZOOM
        ? app.mapZoom.DEFAULT_MAP_ZOOM
        : app.mapZoomPreference;
      app.aiHeuristics = aiHeuristics;
      app.aiPhaseSearch = aiPhaseSearch;
      app.aiTactics = aiTactics;
      app.aiWeights = aiWeights;
      app.online.modules = onlineModules;
      app.aiAlphaBrowser = aiAlphaBrowser;
      const previewLoad = aiAlphaPreview
        ? await aiAlphaPreview.loadLocalAlphaPreviewModel({
            location: window.location,
            loadJson: fetchOptionalJson,
          })
        : {
            requested: false,
            modelLoad: normalAiAlphaModelLoad,
            previewValidationOptions: null,
          };
      const aiAlphaModelLoad = previewLoad.requested
        ? previewLoad.modelLoad
        : normalAiAlphaModelLoad;
      app.aiAlphaModelLoad = aiAlphaModelLoad;
      app.aiHumanDemonstration = aiHumanDemonstration;
      app.aiHumanCapture = aiHumanCapture;
      app.aiHumanRecovery = aiHumanRecovery;
      if (aiAlphaBrowser) {
        app.aiAlpha = aiAlphaBrowser.createBrowserAlphaAi({
          rawModel: aiAlphaModelLoad.value,
          scenario,
          rules,
          workerFactory: aiAlphaBrowser.createAlphaWorkerFactory(),
          timeoutMs: 90,
          logger: console,
          previewValidationOptions: previewLoad.previewValidationOptions,
        });
        app.aiAlphaAnalysisScheduler = aiAlphaBrowser.createBrowserAlphaAnalysisScheduler({
          minIntervalMs: AI_ALPHA_ANALYSIS_INTERVAL_MS,
          defaultSearchOptions: alphaAssessmentSearchOptions(),
          onResult: () => {
            if (app.state && el.body.dataset.view === "game" && isAlphaAssessmentSummaryCurrent()) draw();
          },
          onError: (error) => console.warn("Alpha AI realtime analysis failed.", error),
        });
        app.aiAlphaGameAdapter = aiAlphaBrowser.createBrowserAlphaGameAdapter?.({
          alpha: app.aiAlpha,
          scenario,
          rules,
          getState: () => app.state,
          getSide: () => activeSide(),
          getLegalActions: () => legalAlphaActions(),
          searchOptions: alphaAssessmentSearchOptions(),
          minIntervalMs: AI_ALPHA_ANALYSIS_INTERVAL_MS,
          onSnapshot: (snapshot) => {
            if (app.state && el.body.dataset.view === "game" && snapshot?.status !== "pending" && isAlphaAssessmentSummaryCurrent()) draw();
          },
          onError: (error) => console.warn("Alpha AI realtime adapter failed.", error),
          logger: console,
        }) || null;
      }
      app.scenario = scenario;
      app.rules = rules;
      app.board = app.core.createBoard(scenario);
      app.hexes = app.board.hexes;
      app.hexById = app.board.hexById;
      app.online.rulesetHash = app.online.modules
        ? await app.online.modules.bridge.computeOnlineRulesetHash({ scenario, rules })
        : null;
      const humanAdapterContext = createHumanDemonstrationAdapter({
        environmentAdapterModule: aiAlphaEnvironmentAdapter,
        trainingModule: aiAlphaTraining,
        fingerprintModule: alphaFingerprint,
      });
      app.aiHumanDemonstrationAdapter = humanAdapterContext.adapter;
      app.aiHumanCaptureCodec = app.aiHumanCapture?.createHumanLabCaptureCodec({
        verifyDecision: (state) => app.aiHumanDemonstrationAdapter.verifyDecision(state),
        normalizeAction: (action) => app.core.compactAction(action),
      }) || null;
      app.aiHumanCaptureStore = app.aiHumanCapture?.createHumanLabCaptureStore({
        storage: localStorage,
        keyPrefix: "zizi-el-alamein-alpha-human-lab-capture-v1",
        now: () => new Date().toISOString(),
        codec: app.aiHumanCaptureCodec || undefined,
      }) || null;
      app.aiHumanRecorder = app.aiHumanDemonstration.createHumanDemonstrationRecorder({
        ...humanAdapterContext,
        initialRecording: loadHumanDemonstrationRecording(),
        onChange: persistHumanDemonstrationRecording,
      });
      if (!app.aiHumanRecorder.getRecording()) startHumanDemonstrationRecording();
      app.neighborCache.clear();
      app.distanceCache.clear();
      app.state = makeInitialState();
      wireUi();
      applyMapZoom(app.mapZoomLevel, { preserveCenter: false });
      loadImages();
      applyLanguage();
      updateMenu();
      draw();
    } catch (error) {
      showMissingData(error);
    }
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }

  async function fetchOptionalJson(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status === 404) {
        return { status: "missing", value: null, reason: "model_missing" };
      }
      if (!response.ok) {
        return { status: "failed", value: null, reason: `${url}: ${response.status}` };
      }
      try {
        return { status: "loaded", value: await response.json(), reason: null };
      } catch (error) {
        return { status: "failed", value: null, reason: error?.message || "invalid_model_json" };
      }
    } catch (error) {
      return { status: "failed", value: null, reason: error?.message || "model_load_failed" };
    }
  }

  function showMissingData(error) {
    console.error(error);
    el.body.replaceChildren(el.missingDataTemplate.content.cloneNode(true));
  }

  function loadImages() {
    el.mapImage.src = app.scenario.board.image;
    el.crtImage.src = app.scenario.charts.crtImage;
    el.tecImage.src = app.scenario.charts.terrainImage;
    el.turnTrackImage.src = app.scenario.charts.turnTrackImage;
  }

  function wireUi() {
    el.humanLabPrivacyNotice.hidden = !PRODUCT_PROFILE.features.humanLabCaptureIntegrity;
    el.boardSurface.addEventListener("click", onBoardClick);
    app.mapZoomControlCleanups.push(
      app.mapZoomControlsUi.wirePressAndHoldButton(el.mapZoomOutButton, (kind) => changeMapZoom(-1, kind)),
      app.mapZoomControlsUi.wirePressAndHoldButton(el.mapZoomInButton, (kind) => changeMapZoom(1, kind)),
    );
    el.mapZoomMenuButton.addEventListener("click", toggleMapZoomMenu);
    el.mapZoomMenuOptions.forEach((option) => option.addEventListener("click", () => {
      setMapZoomPreference(option.dataset.mapZoomPreference, { restoreMenuFocus: true });
    }));
    el.mapZoomMenu.addEventListener("keydown", onMapZoomMenuKeydown);
    document.addEventListener("click", (event) => {
      if (!el.mapZoomControls.contains(event.target)) closeMapZoomMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.mapZoomMenu.hidden) {
        event.preventDefault();
        closeMapZoomMenu({ restoreFocus: true });
      }
    });
    window.addEventListener("resize", onMapZoomViewportResize);
    window.addEventListener("pagehide", cleanupMapZoomControls, { once: true });
    if (PRODUCT_PROFILE.features.humanLabCaptureIntegrity) {
      window.addEventListener("beforeunload", protectUnexportedHumanDemonstrationOnLeave);
    }
    el.langZhButton.addEventListener("click", () => setLanguage("zh"));
    el.langEnButton.addEventListener("click", () => setLanguage("en"));
    el.axisAiModeButton.addEventListener("click", () => setGameMode("axis-vs-ai"));
    el.alliedAiModeButton.addEventListener("click", () => setGameMode("allied-vs-ai"));
    el.hotseatModeButton.addEventListener("click", () => setGameMode("hotseat"));
    if (PRODUCT_PROFILE.features.onlineFriendMatch) {
      el.onlineModeButton.addEventListener("click", selectOnlineGameMode);
      el.onlineConnectButton.addEventListener("click", () => void connectOnlineTestServer());
    } else {
      el.onlineModeButton.hidden = true;
      el.onlineSetupPanel.hidden = true;
    }
    el.startCampaignButton.addEventListener("click", startNewCampaign);
    el.continueCampaignButton.addEventListener("click", continueCampaign);
    el.menuLoadButton.addEventListener("click", () => loadGame({ fromMenu: true }));
    el.menuExportHumanDemonstrationButton?.addEventListener("click", exportHumanDemonstration);
    el.menuButton.addEventListener("click", showMenu);
    el.newGameButton.addEventListener("click", startNewCampaign);
    el.saveButton.addEventListener("click", saveGame);
    el.loadButton.addEventListener("click", () => loadGame({ fromMenu: false }));
    el.chartsButton.addEventListener("click", () => el.chartsDialog.showModal());
    el.aarButton.addEventListener("click", () => openAar(false));
    el.exportHumanDemonstrationButton?.addEventListener("click", exportHumanDemonstration);
    el.returnMapButton.addEventListener("click", showGame);
    el.aarMenuButton.addEventListener("click", showMenu);
    el.endPhaseButton.addEventListener("click", endPhase);
    el.finishDeclarationsButton.addEventListener("click", finishDeclarations);
    el.resolveBattleButton.addEventListener("click", resolveNextBattle);
    el.logToggleButton.addEventListener("click", () => {
      app.logExpanded = !app.logExpanded;
      drawLog();
    });
  }

  function onlineClientState() {
    return app.online.runtime?.client?.getState?.() || null;
  }

  function onlineRoom() {
    return onlineClientState()?.room || null;
  }

  function hasOnlineRoom() {
    return Boolean(onlineRoom());
  }

  function isOnlineMatch() {
    return ["active", "finished"].includes(onlineRoom()?.status);
  }

  function setOnlineSetupStatus(message = "", isError = false) {
    app.online.setupStatus = message ? { message, isError: Boolean(isError) } : null;
    renderOnlineSetupStatus();
  }

  function setOnlineSetupStatusI18n(key = "", params = {}, isError = false) {
    app.online.setupStatus = key
      ? { key, params: { ...params }, isError: Boolean(isError) }
      : null;
    renderOnlineSetupStatus();
  }

  function renderOnlineSetupStatus() {
    const setupStatus = app.online.setupStatus;
    el.onlineSetupStatus.textContent = setupStatus
      ? setupStatus.key
        ? tr(setupStatus.key, setupStatus.params)
        : setupStatus.message
      : "";
    el.onlineSetupStatus.dataset.error = String(Boolean(setupStatus?.isError));
  }

  function readRememberedOnlineRoom() {
    try {
      return sessionStorage.getItem(ONLINE_ROOM_SESSION_KEY) || null;
    } catch {
      return null;
    }
  }

  function rememberOnlineRoom(roomCode) {
    try {
      if (roomCode) sessionStorage.setItem(ONLINE_ROOM_SESSION_KEY, roomCode);
      else sessionStorage.removeItem(ONLINE_ROOM_SESSION_KEY);
    } catch (error) {
      console.warn("Unable to update online room session marker.", error);
    }
  }

  function destroyOnlineRuntime() {
    app.online.unsubscribe?.();
    app.online.unsubscribe = null;
    app.online.panel?.destroy?.();
    app.online.panel = null;
    app.online.runtime?.destroy?.();
    app.online.runtime = null;
    app.online.lastAppliedRevision = null;
    app.online.submitting = false;
    app.online.hadRoom = false;
  }

  function selectOnlineGameMode() {
    if (!PRODUCT_PROFILE.features.onlineFriendMatch || !app.online.modules) return;
    app.online.selected = true;
    el.onlineSetupPanel.hidden = false;
    setMenuStatus("");
    syncMenuModeControls();
  }

  async function connectOnlineTestServer() {
    if (!PRODUCT_PROFILE.features.onlineFriendMatch || !app.online.modules) return;
    if (app.online.connecting) return;
    if (hasOnlineRoom()) {
      setOnlineSetupStatusI18n("online.switchConfigBlocked", {}, true);
      return;
    }
    const projectUrl = el.onlineProjectUrlInput.value.trim();
    const publishableKey = el.onlinePublishableKeyInput.value.trim();
    if (!projectUrl || !publishableKey) {
      setOnlineSetupStatusI18n("online.configRequired", {}, true);
      return;
    }

    app.online.connecting = true;
    el.onlineConnectButton.disabled = true;
    setOnlineSetupStatusI18n("online.connecting");
    destroyOnlineRuntime();
    try {
      const { transport, bridge, panel } = app.online.modules;
      const sessionStore = transport.createSupabaseWebStorageSessionStore({
        storage: window.sessionStorage,
      });
      const commandExecutor = bridge.createOnlineGameCommandExecutor({
        core: app.core,
        scenario: app.scenario,
        rules: app.rules,
        board: app.board,
      });
      app.online.runtime = await transport.createSupabaseOnlineRoomRuntime({
        enabled: true,
        projectUrl,
        publishableKey,
        sessionStore,
        rulesetHash: app.online.rulesetHash,
        commandExecutor,
        pollIntervalMs: 1_000,
        onPollError: (error) => setOnlineSetupStatusI18n("online.syncFailed", { reason: error.message }, true),
        onListenerError: (error) => console.error("Online room listener failed.", error),
      });
      app.online.unsubscribe = app.online.runtime.client.subscribe(handleOnlineClientState);
      app.online.panel = panel.createOnlineMultiplayerPanel({
        root: el.onlinePanelRoot,
        client: app.online.runtime.client,
        labels: onlinePanelLabels(),
        getInitialRoomState: async () => ({
          state: bridge.projectOnlineAuthoritativeState(makeInitialState()),
        }),
        onError: (error) => setOnlineSetupStatusI18n("online.operationFailed", {
          code: error.code || "ONLINE_ERROR",
          reason: error.message,
        }, true),
      });
      setOnlineSetupStatusI18n("online.connected");
      const rememberedRoom = readRememberedOnlineRoom();
      if (rememberedRoom) {
        try {
          await app.online.runtime.client.reconnect({ roomCode: rememberedRoom });
          setOnlineSetupStatusI18n("online.restoredRoom", { roomCode: rememberedRoom });
        } catch (error) {
          rememberOnlineRoom(null);
          setOnlineSetupStatusI18n("online.restoreFailed", { reason: error.message }, true);
        }
      }
    } catch (error) {
      destroyOnlineRuntime();
      setOnlineSetupStatusI18n("online.operationFailed", {
        code: error.code || "ONLINE_SETUP_FAILED",
        reason: error.message,
      }, true);
    } finally {
      app.online.connecting = false;
      el.onlineConnectButton.disabled = false;
      updateMenu();
    }
  }

  function handleOnlineClientState(clientState) {
    const room = clientState.room;
    if (!room) {
      app.online.runtime?.stopPolling?.();
      if (app.online.hadRoom) {
        rememberOnlineRoom(null);
        app.online.lastAppliedRevision = null;
        if (el.body.dataset.view === "game") setView("menu");
      }
      app.online.hadRoom = false;
      drawAiControls();
      updateMenu();
      return;
    }

    app.online.hadRoom = true;
    rememberOnlineRoom(room.roomCode);
    app.online.runtime?.startPolling?.({ immediate: true });
    if (["active", "finished"].includes(room.status)) adoptOnlineRoomSnapshot(room);
    if (["abandoned", "expired"].includes(room.status)) {
      setOnlineSetupStatusI18n(
        room.status === "abandoned" ? "online.roomAbandoned" : "online.roomExpired",
        { roomCode: room.roomCode },
        true,
      );
      if (el.body.dataset.view === "game") setView("menu");
    }
  }

  function adoptOnlineRoomSnapshot(room) {
    if (app.online.lastAppliedRevision === room.revision) return;
    const nextState = normalizeState(clone(room.authoritativeState), { preserveTransient: true });
    nextState.selectedUnitId = null;
    nextState.selectedDefenderId = null;
    nextState.selectedAttackers = [];
    nextState.log = [];
    app.state = nextState;
    app.online.lastAppliedRevision = room.revision;
    app.ai.running = false;
    app.ai.scheduled = false;
    app.ai.waitingForHuman = false;
    restoreInteractiveState();
    showGame();
  }

  async function submitOnlineGameAction(action) {
    const client = app.online.runtime?.client;
    if (!client || !isOnlineMatch() || app.online.submitting) return;
    app.online.submitting = true;
    draw();
    try {
      await client.submitGameAction(action);
      setOnlineSetupStatus("");
    } catch (error) {
      setOnlineSetupStatusI18n("online.operationFailed", {
        code: error.code || "ONLINE_ACTION_FAILED",
        reason: error.message,
      }, true);
    } finally {
      app.online.submitting = false;
      draw();
    }
  }

  function setLanguage(lang) {
    app.lang = lang === "en" ? "en" : "zh";
    localStorage.setItem(LANG_KEY, app.lang);
    applyLanguage();
    updateMenu();
    draw();
    if (!el.aarView.hidden) renderAar();
  }

  function applyLanguage() {
    document.documentElement.lang = app.lang === "en" ? "en" : "zh-CN";
    el.body.dataset.lang = app.lang;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = tr(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
      node.setAttribute("aria-label", tr(node.dataset.i18nAriaLabel));
    });
    el.langZhButton.dataset.active = String(app.lang === "zh");
    el.langEnButton.dataset.active = String(app.lang === "en");
    renderOnlineSetupStatus();
    app.online.panel?.setLabels?.(onlinePanelLabels());
    drawAiControls();
    drawMapZoomControls();
  }

  function setGameMode(mode) {
    if (hasOnlineRoom()) {
      setOnlineSetupStatusI18n("online.offlineSwitchBlocked", {}, true);
      return;
    }
    destroyOnlineRuntime();
    app.online.selected = false;
    el.onlineSetupPanel.hidden = true;
    app.ai.mode = ["axis-vs-ai", "allied-vs-ai", "hotseat"].includes(mode) ? mode : "axis-vs-ai";
    app.ai.humanSide = humanSideForMode(app.ai.mode);
    app.ai.waitingForHuman = false;
    app.ai.scheduled = false;
    localStorage.setItem(AI_GAME_MODE_KEY, app.ai.mode);
    localStorage.setItem(AI_HUMAN_SIDE_KEY, app.ai.humanSide);
    syncMenuModeControls();
    drawStatus();
    scheduleAiTurn();
  }

  function syncMenuModeControls() {
    drawAiControls();
    updateMenu();
  }

  function drawAiControls() {
    const selection = app.menuModeSelection.createMenuGameModeSelection({
      offlineMode: app.ai.mode,
      onlineSelected: app.online.selected,
    });
    const modeButtons = [
      [el.axisAiModeButton, "axis-vs-ai"],
      [el.alliedAiModeButton, "allied-vs-ai"],
      [el.hotseatModeButton, "hotseat"],
      [el.onlineModeButton, "online"],
    ];
    for (const [button, mode] of modeButtons) {
      if (!button) continue;
      const active = Boolean(selection[mode]);
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    }
    el.onlineSetupPanel.hidden = !app.online.selected;
  }

  function setMenuStatus(text = "") {
    el.menuStatus.textContent = text;
  }

  function updateMenu() {
    const actionState = app.menuModeSelection.createMenuActionState({
      onlineSelected: app.online.selected,
      hasContinuation: Boolean(localStorage.getItem(SESSION_KEY) || localStorage.getItem(CHECKPOINT_KEY)),
      hasSave: Boolean(localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY)),
    });
    el.startCampaignButton.disabled = actionState.startDisabled;
    el.continueCampaignButton.disabled = actionState.continueDisabled;
    el.menuLoadButton.disabled = actionState.loadDisabled;
    renderHumanLabRecoveryUi();
  }

  function setView(view) {
    el.body.dataset.view = view;
    el.aarView.hidden = view !== "aar";
    if (view === "game") {
      window.setTimeout(() => {
        applyPreferredMapZoom({ preserveCenter: false });
        centerOnOpeningFront();
      }, 30);
    }
  }

  function showMenu() {
    if (!isOnlineMatch()) saveSessionState();
    setView("menu");
    updateMenu();
  }

  function showGame() {
    setView("game");
    if (!isOnlineMatch()) checkAlliedBreakthroughVictory();
    draw();
  }

  function startNewCampaign() {
    if (app.online.selected || hasOnlineRoom()) {
      setOnlineSetupStatusI18n("online.startFromReady", {}, true);
      return;
    }
    if (!prepareHumanDemonstrationForNewGame()) return;
    localStorage.removeItem(SESSION_KEY);
    app.focusedBattleId = null;
    app.ai.running = false;
    app.ai.scheduled = false;
    app.ai.waitingForHuman = false;
    app.state = makeInitialState();
    startHumanDemonstrationRecording();
    app.reachable.clear();
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
    recordGameStartedEvents();
    saveTurnCheckpoint();
    showGame();
    log(tr("text.newGame"));
    draw();
  }

  function saveGame() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(app.state));
    checkpointHumanDemonstration("manual", "SAVE", app.state);
    log(tr("text.saved"));
    updateMenu();
    draw();
  }

  function loadGame(options = {}) {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY);
    if (!raw) {
      setMenuStatus(tr("menu.noSave"));
      if (!options.fromMenu) {
        log(tr("text.noSave"));
        draw();
      }
      return;
    }
    try {
      const nextState = normalizeState(JSON.parse(raw), { preserveTransient: true });
      const captureStatus = restoreHumanDemonstrationCheckpoint("manual", nextState);
      const capturePolicy = applyHumanLabContinuationPolicy(captureStatus);
      app.state = nextState;
      app.focusedBattleId = null;
      app.ai.running = false;
      app.ai.scheduled = false;
      app.ai.waitingForHuman = false;
      restoreInteractiveState();
      log(tr("text.loaded"));
      setMenuStatus(tr("menu.loaded"));
      showGame();
      if (capturePolicy.requiresExport) log(tr("text.humanLabCapturePaused"));
    } catch (_) {
      setMenuStatus(tr("menu.noSave"));
      if (!options.fromMenu) log(tr("text.badSave"));
      draw();
    }
  }

  function saveTurnCheckpoint() {
    const snapshot = clone(app.state);
    snapshot.selectedUnitId = null;
    snapshot.selectedDefenderId = null;
    snapshot.selectedAttackers = [];
    snapshot.retreatTask = null;
    snapshot.advanceTask = null;
    snapshot.lastMove = null;
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(snapshot));
    checkpointHumanDemonstration("turn", "TURN_CHECKPOINT", snapshot);
    updateMenu();
  }

  function saveSessionState() {
    if (!app.state) return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(app.state));
    checkpointHumanDemonstration("session", "SESSION_CHECKPOINT", app.state);
    updateMenu();
  }

  function continueCampaign() {
    const sessionRaw = localStorage.getItem(SESSION_KEY);
    const checkpointRaw = localStorage.getItem(CHECKPOINT_KEY);
    const raw = sessionRaw || checkpointRaw;
    if (!raw) {
      setMenuStatus(tr("menu.noCheckpoint"));
      return;
    }
    try {
      const nextState = normalizeState(JSON.parse(raw), { preserveTransient: Boolean(sessionRaw) });
      const captureStatus = restoreHumanDemonstrationCheckpoint(sessionRaw ? "session" : "turn", nextState);
      const capturePolicy = applyHumanLabContinuationPolicy(captureStatus);
      app.state = nextState;
      app.focusedBattleId = null;
      app.ai.running = false;
      app.ai.scheduled = false;
      app.ai.waitingForHuman = false;
      if (sessionRaw) restoreInteractiveState();
      else clearTransientState();
      setMenuStatus(tr("menu.continued"));
      showGame();
      if (capturePolicy.requiresExport) log(tr("text.humanLabCapturePaused"));
    } catch (_) {
      setMenuStatus(tr("menu.noCheckpoint"));
    }
  }

  function restoreInteractiveState() {
    app.focusedBattleId = null;
    app.reachable.clear();
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
    if (app.state.selectedUnitId) {
      const unit = unitById(app.state.selectedUnitId);
      if (unit && isMovementPhase() && unit.side === activeSide() && !unit.disrupted && !app.state.movedUnits.includes(unit.id)) {
        app.reachable = reachableHexes(unit);
      }
    }
    if (app.state.retreatTask) prepareCurrentRetreat({ silent: true });
  }

  function clearTransientState() {
    app.focusedBattleId = null;
    app.state.selectedUnitId = null;
    app.state.selectedDefenderId = null;
    app.state.selectedAttackers = [];
    app.state.retreatTask = null;
    app.state.advanceTask = null;
    app.state.lastMove = null;
    app.reachable.clear();
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
  }

  function centerOnOpeningFront() {
    el.boardViewport.scrollLeft = 360 * app.mapZoomLevel;
    el.boardViewport.scrollTop = 0;
  }

  function changeMapZoom(direction, kind = "click") {
    const step = kind === "hold" ? app.mapZoom.MAP_ZOOM_HOLD_STEP : app.mapZoom.MAP_ZOOM_CLICK_STEP;
    const nextPreference = app.mapZoom.adjustMapZoomPreference(app.mapZoomPreference, direction, step);
    setMapZoomPreference(nextPreference);
  }

  function setMapZoomPreference(preference, { restoreMenuFocus = false } = {}) {
    app.mapZoomPreference = app.mapZoom.normalizeMapZoomPreference(preference);
    app.mapZoom.writeMapZoomPreference(
      localStorage,
      PRODUCT_PROFILE.storage.mapZoomStorageKey,
      app.mapZoomPreference,
    );
    closeMapZoomMenu({ restoreFocus: restoreMenuFocus });
    applyPreferredMapZoom();
  }

  function applyMapZoom(nextZoom, { preserveCenter = true } = {}) {
    const currentZoom = app.mapZoom.clampRenderedMapZoom(app.mapZoomLevel);
    const normalizedZoom = app.mapZoom.clampRenderedMapZoom(nextZoom);
    const nextScroll = preserveCenter
      ? app.mapZoom.preserveMapViewportCenter({
          scrollLeft: el.boardViewport.scrollLeft,
          scrollTop: el.boardViewport.scrollTop,
          clientWidth: el.boardViewport.clientWidth,
          clientHeight: el.boardViewport.clientHeight,
          currentZoom,
          nextZoom: normalizedZoom,
        })
      : null;
    const stageSize = app.mapZoom.mapZoomStageSize({
      width: app.scenario.board.width,
      height: app.scenario.board.height,
      zoom: normalizedZoom,
    });
    app.mapZoomLevel = normalizedZoom;
    el.mapZoomStage.style.width = `${stageSize.width}px`;
    el.mapZoomStage.style.height = `${stageSize.height}px`;
    el.boardSurface.style.transform = `scale(${normalizedZoom})`;
    drawMapZoomControls();
    if (nextScroll) {
      el.boardViewport.scrollLeft = nextScroll.scrollLeft;
      el.boardViewport.scrollTop = nextScroll.scrollTop;
    }
  }

  function applyPreferredMapZoom({ preserveCenter = true } = {}) {
    if (!app.mapZoom || el.body.dataset.view !== "game") return;
    app.mapZoomFitCancel?.();
    app.mapZoomFitCancel = app.mapZoom.fitMapZoomWithDeferredStabilization({
      measureViewport: () => ({
        viewportWidth: el.boardViewport.clientWidth,
        viewportHeight: el.boardViewport.clientHeight,
      }),
      applyZoom: (fitZoom) => applyMapZoom(
        app.mapZoom.calculateMapZoomForPreference({
          fitZoom,
          preference: app.mapZoomPreference,
        }),
        { preserveCenter },
      ),
      mapWidth: app.scenario.board.width,
      mapHeight: app.scenario.board.height,
    });
  }

  function onMapZoomViewportResize() {
    if (!app.mapZoom) return;
    window.clearTimeout(app.mapZoomResizeTimer);
    app.mapZoomResizeTimer = window.setTimeout(() => applyPreferredMapZoom(), 60);
  }

  function toggleMapZoomMenu() {
    const willOpen = el.mapZoomMenu.hidden;
    el.mapZoomMenu.hidden = !willOpen;
    el.mapZoomMenuButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) {
      const checkedOption = el.mapZoomMenuOptions.find((option) => option.getAttribute("aria-checked") === "true");
      (checkedOption || el.mapZoomMenuOptions[0])?.focus();
    }
  }

  function closeMapZoomMenu({ restoreFocus = false } = {}) {
    app.mapZoomControlsUi.closeMapZoomMenuElement(
      el.mapZoomMenu,
      el.mapZoomMenuButton,
      { restoreFocus },
    );
  }

  function onMapZoomMenuKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMapZoomMenu({ restoreFocus: true });
      return;
    }
    const currentIndex = el.mapZoomMenuOptions.indexOf(document.activeElement);
    const nextIndex = app.mapZoomControlsUi.nextMapZoomMenuIndex(
      currentIndex,
      event.key,
      el.mapZoomMenuOptions.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    el.mapZoomMenuOptions[nextIndex].focus();
  }

  function cleanupMapZoomControls() {
    window.clearTimeout(app.mapZoomResizeTimer);
    app.mapZoomResizeTimer = null;
    app.mapZoomFitCancel?.();
    app.mapZoomFitCancel = null;
    app.mapZoomControlCleanups.splice(0).forEach((cleanup) => cleanup());
  }

  function updateMapZoomControlsOffset() {
    const scrollbarWidth = Math.max(0, el.boardViewport.offsetWidth - el.boardViewport.clientWidth);
    el.mapZoomControls.style.setProperty("--map-scrollbar-width", `${scrollbarWidth}px`);
  }

  function drawMapZoomControls() {
    if (!app.mapZoom) return;
    const levels = app.mapZoom.MAP_ZOOM_LEVELS;
    const isFit = app.mapZoomPreference === app.mapZoom.FIT_MAP_ZOOM;
    const manualPreference = isFit
      ? app.mapZoom.DEFAULT_MAP_ZOOM
      : app.mapZoom.normalizeMapZoom(app.mapZoomPreference);
    el.mapZoomControls.setAttribute("aria-label", tr("ui.mapZoom"));
    el.mapZoomOutButton.setAttribute("aria-label", tr("ui.mapZoomOut"));
    el.mapZoomOutButton.title = tr("ui.mapZoomOut");
    el.mapZoomOutButton.disabled = !isFit && manualPreference <= levels[0];
    const zoomText = app.mapZoom.formatMapZoom(app.mapZoomLevel);
    el.mapZoomOutput.textContent = isFit
      ? `${tr("ui.mapZoomFit")} ${zoomText}`
      : app.mapZoom.formatMapZoom(manualPreference);
    el.mapZoomMenuButton.setAttribute("aria-label", tr("ui.mapZoomChoose"));
    el.mapZoomMenuButton.title = tr("ui.mapZoomChoose");
    el.mapZoomMenuOptions.forEach((option) => {
      const optionPreference = app.mapZoom.normalizeMapZoomPreference(option.dataset.mapZoomPreference);
      option.setAttribute("aria-checked", String(optionPreference === app.mapZoomPreference));
    });
    el.mapZoomInButton.setAttribute("aria-label", tr("ui.mapZoomIn"));
    el.mapZoomInButton.title = tr("ui.mapZoomIn");
    el.mapZoomInButton.disabled = !isFit && manualPreference >= levels[levels.length - 1];
    updateMapZoomControlsOffset();
  }

  function onBoardClick(event) {
    if (app.animating || el.body.dataset.view !== "game") return;
    if (isHumanInputBlocked()) return;
    const rect = el.boardSurface.getBoundingClientRect();
    const scaleX = app.scenario.board.width / rect.width;
    const scaleY = app.scenario.board.height / rect.height;
    const point = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
    const hex = nearestHex(point);
    if (!hex) return;
    if (app.state.retreatTask) {
      chooseRetreatHex(hex.id);
      return;
    }
    if (app.reachable.has(hex.id)) {
      attemptMove(hex.id);
      return;
    }
    if (isCombatPhase() && app.state.combatMode === "declare") {
      chooseCombatHex(hex.id);
    }
  }

  function nearestHex(point) {
    let best = null;
    for (const hex of app.hexes) {
      const score = Math.hypot(hex.center.x - point.x, hex.center.y - point.y);
      if (!best || score < best.score) best = { hex, score };
    }
    return best?.score < 58 ? best.hex : null;
  }

  function onUnitClick(event, unitId) {
    event.stopPropagation();
    if (app.animating) return;
    if (isHumanInputBlocked()) return;
    const unit = unitById(unitId);
    if (!unit || unit.eliminated) return;
    if (app.state.advanceTask) {
      if (app.state.advanceTask.attackerIds.includes(unit.id)) advanceUnit(unit.id);
      return;
    }
    if (app.state.retreatTask) return;
    if (isMovementPhase()) {
      if (unit.side === activeSide()) selectUnit(unit);
      return;
    }
    if (isCombatPhase() && app.state.combatMode === "declare") {
      if (unit.side === activeSide()) toggleCombatAttacker(unit);
      else setCombatDefender(unit);
      draw();
    }
  }

  function selectUnit(unit) {
    if (app.state.selectedUnitId === unit.id && !canUndoLastMove(unit)) {
      app.state.selectedUnitId = null;
      app.reachable.clear();
      draw();
      return;
    }
    app.state.selectedUnitId = unit.id;
    app.state.selectedDefenderId = null;
    app.state.selectedAttackers = [];
    app.reachable.clear();
    if (unit.side === activeSide() && !unit.disrupted && !app.state.movedUnits.includes(unit.id)) {
      app.reachable = reachableHexes(unit);
    }
    draw();
  }

  function canUndoLastMove(unit = unitById(app.state.selectedUnitId)) {
    if (isOnlineMatch()) return false;
    const move = app.state.lastMove;
    return Boolean(
      move
      && unit
      && move.unitId === unit.id
      && isMovementPhase()
      && move.turn === app.state.turn
      && move.phaseIndex === app.state.phaseIndex
      && !app.state.winner
      && !app.animating
    );
  }

  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const yieldToBrowser = () => delay(0);

  async function animateUnitPath(unit, path) {
    app.animating = true;
    const stepDelay = app.ai.running
      ? (isCombatPhase() ? 260 : 100)
      : 70;
    for (const hexId of path.slice(1)) {
      unit.hexId = hexId;
      drawAnimationFrame();
      await delay(stepDelay);
    }
    app.animating = false;
  }

  function chooseCombatHex(hexId) {
    const unit = liveUnitAt(hexId);
    if (!unit) return;
    if (unit.side !== activeSide()) setCombatDefender(unit);
    else toggleCombatAttacker(unit);
    draw();
  }

  function setCombatDefender(unit) {
    if (unit.side === activeSide() || unit.disrupted || app.state.usedDefenders.includes(unit.id)) return;
    if (app.state.selectedDefenderId === unit.id) {
      app.state.selectedDefenderId = null;
      app.state.selectedAttackers = [];
      log(tr("text.battleCancelled"));
      return;
    }
    const attackers = neighborsOf(unit.hexId)
      .map(liveUnitAt)
      .filter((attacker) => canAttack(attacker, unit));
    if (!attackers.length) {
      log(tr("text.noLegalAttackers"));
      return;
    }
    app.state.selectedDefenderId = unit.id;
    app.state.selectedAttackers = attackers.map((attacker) => attacker.id);
  }

  function toggleCombatAttacker(unit) {
    if (!unit || unit.side !== activeSide() || unit.disrupted || app.state.usedAttackers.includes(unit.id)) return;
    const defender = unitById(app.state.selectedDefenderId);
    if (defender && !canAttack(unit, defender)) return;
    if (app.state.selectedAttackers.includes(unit.id)) {
      app.state.selectedAttackers = app.state.selectedAttackers.filter((id) => id !== unit.id);
    } else {
      app.state.selectedAttackers.push(unit.id);
    }
  }

  function canAttack(attacker, defender) {
    if (!attacker || !defender) return false;
    if (attacker.side !== activeSide()) return false;
    if (attacker.disrupted || defender.disrupted) return false;
    if (app.state.usedAttackers.includes(attacker.id)) return false;
    if (app.state.usedDefenders.includes(defender.id)) return false;
    return neighborsOf(attacker.hexId).includes(defender.hexId);
  }

  function declareBattle() {
    const defender = unitById(app.state.selectedDefenderId);
    const attackers = app.state.selectedAttackers.map(unitById).filter(Boolean);
    if (!defender || !attackers.length) return;
    if (attackers.some((attacker) => !canAttack(attacker, defender))) return;
    if (isOnlineMatch()) {
      void submitOnlineGameAction({
        type: app.core.ENV_ACTION.DECLARE_COMBAT,
        defenderId: defender.id,
        attackerIds: attackers.map((unit) => unit.id),
      });
      return;
    }
    const odds = calculateOdds(attackers, defender);
    const eventStateBefore = clone(app.state);
    const trainingEntry = combatTrainingEntry(attackers, defender, odds);
    recordHumanDemonstrationDecision({
      type: app.core.ENV_ACTION.DECLARE_COMBAT,
      defenderId: defender.id,
      attackerIds: attackers.map((unit) => unit.id),
    }, eventStateBefore);
    const battle = {
      id: `b${Date.now()}-${app.state.declaredCombats.length}`,
      turn: app.state.turn,
      phaseId: phase().id,
      side: activeSide(),
      defenderId: defender.id,
      defenderHexId: defender.hexId,
      attackerIds: attackers.map((unit) => unit.id),
      attackerOrigins: Object.fromEntries(attackers.map((unit) => [unit.id, unit.hexId])),
      attackerHexIds: attackers.map((unit) => unit.hexId),
      oddsAtDeclaration: formatOddsWithDefense(odds),
      oddsShort: formatOdds(odds),
      resolved: false,
      result: null,
      events: [],
    };
    app.state.declaredCombats.push(battle);
    app.state.combatCompleteNotified = false;
    app.state.usedDefenders.push(defender.id);
    app.state.usedAttackers.push(...attackers.map((unit) => unit.id));
    recordTrainingEntry(trainingEntry);
    recordTrainingEvent("COMBAT_DECLARED", eventStateBefore, {
      battleId: battle.id,
      side: battle.side,
      defender: unitTrainingSnapshot(defender),
      defenderId: defender.id,
      defenderHexId: defender.hexId,
      defenderHex: hexLabel(defender.hexId),
      attackers: attackers.map(unitTrainingSnapshot),
      attackerIds: attackers.map((unit) => unit.id),
      attackerHexIds: attackers.map((unit) => unit.hexId),
      odds: {
        attack: odds.attack,
        defense: odds.defense,
        ratio: odds.ratio,
        columnIndex: odds.columnIndex,
        column: odds.column,
        label: formatOdds(odds),
      },
    });
    log(tr("text.battleDeclared", {
      attackers: attackers.map(unitName).join(" + "),
      defender: unitName(defender),
    }));
    app.state.selectedDefenderId = null;
    app.state.selectedAttackers = [];
    draw();
  }

  function cancelDeclaredBattle(battleId) {
    if (isOnlineMatch()) return;
    if (!isCombatPhase() || app.state.combatMode !== "declare") return;
    const battle = app.state.declaredCombats.find((item) => item.id === battleId);
    if (!battle) return;
    if (app.focusedBattleId === battleId) app.focusedBattleId = null;
    app.state.declaredCombats = app.state.declaredCombats.filter((item) => item.id !== battleId);
    app.state.usedDefenders = app.state.usedDefenders.filter((id) => id !== battle.defenderId);
    app.state.usedAttackers = app.state.usedAttackers.filter((id) => !battle.attackerIds.includes(id));
    app.state.combatCompleteNotified = false;
    if (app.state.selectedDefenderId === battle.defenderId) {
      app.state.selectedDefenderId = null;
      app.state.selectedAttackers = [];
    }
    log(tr("text.battleCancelled"));
    draw();
  }

  function finishDeclarations() {
    if (!isCombatPhase() || app.state.combatMode !== "declare") return;
    if (isOnlineMatch()) {
      void submitOnlineGameAction({ type: app.core.ENV_ACTION.FINISH_DECLARATIONS });
      return;
    }
    const eventStateBefore = clone(app.state);
    recordHumanDemonstrationDecision({ type: app.core.ENV_ACTION.FINISH_DECLARATIONS }, eventStateBefore);
    const aiPhase = isAiTurn();
    if (aiPhase) app.ai.waitingForHuman = false;
    app.state.combatMode = "resolve";
    app.state.combatCompleteNotified = !app.state.declaredCombats.length;
    log(app.state.declaredCombats.length ? tr("text.declarationsComplete") : tr("text.noBattle"));
    if (aiPhase) app.ai.waitingForHuman = true;
    draw();
    if (app.state.declaredCombats.length && !aiPhase) window.setTimeout(() => resolveNextBattle(), 90);
  }

  function currentBattle() {
    if (app.state.retreatTask) return battleById(app.state.retreatTask.battleId) || app.state.retreatTask.battle;
    if (app.state.advanceTask) return app.state.declaredCombats.find((battle) => battle.id === app.state.advanceTask.battleId) || null;
    return app.state.declaredCombats.find((item) => !item.resolved) || null;
  }

  function focusedBattle() {
    if (!app.focusedBattleId) return null;
    return battleById(app.focusedBattleId);
  }

  function toggleFocusedBattle(battleId) {
    app.focusedBattleId = app.focusedBattleId === battleId ? null : battleId;
    draw();
  }

  function battleById(id) {
    return app.state.declaredCombats.find((battle) => battle.id === id) || null;
  }

  function hasPendingBattles() {
    return app.state.declaredCombats.some((item) => !item.resolved);
  }

  function markCombatCompleteOnce() {
    if (!isCombatPhase() || app.state.combatMode !== "resolve") return;
    if (app.state.retreatTask || app.state.advanceTask || hasPendingBattles()) return;
    if (!app.state.combatCompleteNotified) {
      app.state.combatCompleteNotified = true;
      log(tr("text.allDone"));
    }
  }

  function resolveNextBattle() {
    if (!isCombatPhase() || app.state.combatMode !== "resolve") return;
    if (app.state.retreatTask || app.state.advanceTask) return;
    if (isOnlineMatch()) {
      const battle = currentBattle();
      if (!battle) return;
      void submitOnlineGameAction({
        type: app.core.ENV_ACTION.RESOLVE_COMBAT,
        battleId: battle.id,
        dieRoll: app.online.modules.bridge.rollOnlineFriendDie(),
      });
      return;
    }
    const aiPhase = isAiTurn();
    if (aiPhase) app.ai.waitingForHuman = false;
    const battle = currentBattle();
    const eventStateBefore = clone(app.state);
    if (!battle) {
      markCombatCompleteOnce();
      if (aiPhase) app.ai.waitingForHuman = true;
      draw();
      return;
    }
    const defender = unitById(battle.defenderId);
    const attackers = battle.attackerIds.map(unitById).filter((unit) => unit && !unit.eliminated);
    if (!defender || defender.eliminated || !attackers.length) {
      battle.resolved = true;
      battle.result = "Skipped";
      app.state.lastCombatResult = { battleId: battle.id, result: "Skipped", events: [] };
      recordTrainingEvent("COMBAT_RESOLVED", eventStateBefore, {
        battleId: battle.id,
        side: battle.side,
        defenderId: battle.defenderId,
        attackerIds: battle.attackerIds.slice(),
        result: "Skipped",
        skipped: true,
      });
      log(tr("text.battleSkipped"));
      markCombatCompleteOnce();
      if (aiPhase) app.ai.waitingForHuman = true;
      draw();
      return;
    }
    const odds = calculateOdds(attackers, defender);
    const roll = Math.floor(Math.random() * 6) + 1;
    const result = app.rules.crt.rows[String(roll)][odds.columnIndex];
    battle.result = `${roll}/${odds.column}/${result}`;
    battle.resultCode = result;
    battle.roll = roll;
    battle.crtColumn = odds.column;
    battle.oddsAtResolution = formatOddsWithDefense(odds);
    battle.oddsShort = formatOdds(odds);
    battle.events = [];
    app.state.lastCombatResult = {
      battleId: battle.id,
      result,
      roll,
      column: odds.column,
      odds: formatOdds(odds),
      defenderHex: hexLabel(battle.defenderHexId),
      events: battle.events,
    };
    log(`${tr("text.currentBattle")}: ${formatBattleTitle(battle)} · ${tr("text.result")} ${combatResultLabel(result)}`);
    applyCombatResult(battle, result);
    const afterCombatSnapshot = trainingStateSnapshot(app.state);
    recordTrainingEvent("COMBAT_RESOLVED", eventStateBefore, {
      battleId: battle.id,
      side: battle.side,
      defenderId: battle.defenderId,
      defenderHexId: battle.defenderHexId,
      attackerIds: battle.attackerIds.slice(),
      attackerHexIds: battle.attackerHexIds.slice(),
      dieRoll: roll,
      result,
      odds: {
        attack: odds.attack,
        defense: odds.defense,
        ratio: odds.ratio,
        columnIndex: odds.columnIndex,
        column: odds.column,
        label: formatOdds(odds),
      },
      eliminatedUnitIds: app.state.eliminatedUnitIds.filter((id) => !eventStateBefore.eliminatedUnitIds.includes(id)),
      retreatTask: afterCombatSnapshot.retreatTask,
      advanceTask: afterCombatSnapshot.advanceTask,
    });
    markCombatCompleteOnce();
    if (aiPhase && !app.state.retreatTask && !app.state.advanceTask) app.ai.waitingForHuman = true;
    draw();
  }

  function calculateOdds(attackers, defender) {
    const attack = attackers.reduce((sum, unit) => sum + unit.combat, 0);
    const defenseInfo = defenseBreakdown(defender);
    const defense = defenseInfo.total;
    const ratio = attack / Math.max(1, defense);
    const thresholds = [0.5, 1, 2, 3, 4, 5, 6];
    let columnIndex = 0;
    for (let index = 0; index < thresholds.length; index += 1) {
      if (ratio >= thresholds[index]) columnIndex = index;
    }
    return { attack, defense, defenseInfo, ratio, columnIndex, column: app.rules.crt.columns[columnIndex] };
  }

  function formatOdds(odds) {
    if (!odds) return "--";
    return `${odds.attack}:${odds.defense} / ${odds.column}`;
  }

  function formatOddsWithDefense(odds) {
    if (!odds) return "--";
    const detail = formatDefenseDetail(odds.defenseInfo);
    return detail ? `${formatOdds(odds)}; ${detail}` : formatOdds(odds);
  }

  function formatDefenseDetail(info) {
    if (!info || !info.effects.length) return "";
    const effects = info.effects.join(", ");
    return `${tr("text.defense")} ${info.base} x ${info.multiplier} = ${info.total} (${effects})`;
  }

  function defenseBreakdown(unit) {
    const hex = hexById(unit.hexId);
    const terrain = terrainRule(hex);
    const terrainMultiplier = Number(terrain.defenseMultiplier || 1);
    const effects = [];
    let multiplier = terrainMultiplier;
    if (terrainMultiplier > 1) effects.push(`${terrainName(hex?.terrain)} x${terrainMultiplier}`);

    const positionRule = app.rules.britishPosition;
    if (hex?.britishPosition && unit.side === positionRule.appliesOnlyToSide) {
      const positionMultiplier = Number(positionRule.defenseMultiplier || 1);
      if (positionMultiplier > multiplier) {
        multiplier = positionMultiplier;
        effects.length = 0;
        effects.push(`${tr("terrain.britishPosition")} x${positionMultiplier}`);
      } else if (positionMultiplier > 1 && terrainMultiplier <= 1) {
        multiplier = Math.max(multiplier, positionMultiplier);
        effects.push(`${tr("terrain.britishPosition")} x${positionMultiplier}`);
      }
    }
    return { base: unit.combat, multiplier, total: unit.combat * multiplier, effects };
  }

  function terrainName(key) {
    return tr(`terrain.${key || "desert"}`);
  }

  function previewOddsText(attackers, defender) {
    if (!defender || !attackers.length) return `${tr("text.odds")}: --`;
    return `${tr("text.odds")}: ${formatOddsWithDefense(calculateOdds(attackers, defender))}`;
  }

  function combatResultLabel(result) {
    if (result === "AE" || result === "AR" || result === "DE" || result === "Skipped") return tr(`result.${result}`);
    const match = result.match(/^DR(\d+)$/);
    if (match) return tr("result.DR", { steps: match[1] });
    return result;
  }

  function applyCombatResult(battle, result) {
    const plan = app.core.planCombatResult(coreContext(), battle, result);
    for (const id of plan.eliminatedUnitIds) eliminateUnit(id, battle.id);
    if (plan.resolveBattle) battle.resolved = true;
    if (plan.retreatTask) {
      startRetreatTask({ battle, ...plan.retreatTask });
      return;
    }
    if (plan.startAdvance) startAdvanceTask(battle);
    if (plan.archiveBattle) archiveBattleReport(battle);
  }

  function eliminateUnit(id, battleId = null) {
    const unit = unitById(id);
    if (!unit || unit.eliminated) return;
    unit.eliminated = true;
    unit.disrupted = false;
    app.state.eliminatedUnitIds.push(unit.id);
    app.state.losses[unit.side].units += 1;
    app.state.losses[unit.side].combat += unit.combat;
    if (battleId) addBattleEvent(battleId, { type: "eliminated", unitId: unit.id, text: tr("text.eliminated", { unit: unitName(unit) }) });
    log(tr("text.eliminated", { unit: unitName(unit) }));
  }

  function addBattleEvent(battleId, event) {
    const battle = battleById(battleId);
    if (!battle) return;
    battle.events ||= [];
    battle.events.push(event);
    if (app.state.lastCombatResult?.battleId === battleId) app.state.lastCombatResult.events = battle.events;
  }

  function archiveBattleReport(battle) {
    if (app.state.battleReports.some((item) => item.id === battle.id)) return;
    app.state.battleReports.push({
      id: battle.id,
      turn: battle.turn,
      phaseId: battle.phaseId,
      side: battle.side,
      defenderId: battle.defenderId,
      defenderHexId: battle.defenderHexId,
      attackerIds: battle.attackerIds,
      attackerHexIds: battle.attackerHexIds,
      odds: battle.oddsShort,
      roll: battle.roll,
      column: battle.crtColumn,
      result: battle.resultCode || battle.result,
      events: clone(battle.events || []),
    });
  }

  function startRetreatTask(task) {
    task.battleId = task.battle?.id || task.battleId;
    task.index = 0;
    task.remainingSteps = task.steps;
    task.origins ||= {};
    task.controllerSide ||= task.battle?.side || battleById(task.battleId)?.side || activeSide();
    app.state.retreatTask = task;
    prepareCurrentRetreat();
  }

  function prepareCurrentRetreat(options = {}) {
    const task = app.state.retreatTask;
    if (!task) return;
    while (task.index < task.unitIds.length) {
      const unit = unitById(task.unitIds[task.index]);
      if (!unit || unit.eliminated) {
        task.index += 1;
        task.remainingSteps = task.steps;
        continue;
      }
      const originHexId = task.origins[unit.id] || unit.hexId;
      task.remainingSteps = task.steps;
      app.retreatPaths = legalRetreatPaths(unit, task.steps, originHexId);
      app.legalRetreatSteps = new Set(app.retreatPaths.keys());
      app.legalRetreats = new Set(app.retreatPaths.keys());
      if (app.retreatPaths.size) {
        if (!options.silent) log(tr("text.retreatNeeded", { unit: unitName(unit), steps: task.steps }));
        if (!options.silent) draw();
        return;
      }
      eliminateUnit(unit.id, task.battleId);
      task.index += 1;
      task.remainingSteps = task.steps;
    }
    finishRetreatTask();
  }

  async function chooseRetreatHex(hexId) {
    const task = app.state.retreatTask;
    if (!task || !app.retreatPaths.has(hexId)) return;
    const unit = unitById(task.unitIds[task.index]);
    if (!unit) return;
    const path = app.retreatPaths.get(hexId);
    if (isOnlineMatch()) {
      await submitOnlineGameAction({
        type: app.core.ENV_ACTION.RETREAT_UNIT,
        unitId: unit.id,
        toHexId: hexId,
        route: { path: path.slice(), remaining: 0 },
        battleId: task.battleId || null,
      });
      return;
    }
    const eventStateBefore = clone(app.state);
    const fromHexId = unit.hexId;
    const trainingEntry = retreatTrainingEntry(unit, hexId, path);
    recordHumanDemonstrationDecision({
      type: app.core.ENV_ACTION.RETREAT_UNIT,
      unitId: unit.id,
      toHexId: hexId,
      route: { path: path.slice(), remaining: 0 },
      battleId: task.battleId || null,
    }, eventStateBefore, { side: retreatControllerSide() });
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
    await animateUnitPath(unit, path);
    unit.hexId = hexId;
    const movedSteps = Math.max(0, path.length - 1);
    if (movedSteps > task.steps) {
      addBattleEvent(task.battleId, { type: "retreat-extra", unitId: unit.id, toHexId: hexId, text: tr("text.retreatExtra", { unit: unitName(unit) }) });
      log(tr("text.retreatExtra", { unit: unitName(unit) }));
    }
    addBattleEvent(task.battleId, { type: "retreat", unitId: unit.id, toHexId: hexId, text: tr("text.retreated", { unit: unitName(unit), hex: hexLabel(hexId) }) });
    recordTrainingEntry(trainingEntry);
    log(tr("text.retreated", { unit: unitName(unit), hex: hexLabel(hexId) }));
    unit.disrupted = Boolean(task.disruptAfterRetreat);
    task.index += 1;
    task.remainingSteps = task.steps;
    prepareCurrentRetreat();
    recordTrainingEvent("UNIT_RETREATED", eventStateBefore, {
      battleId: task.battleId || null,
      unitId: unit.id,
      unit: unitTrainingSnapshot(unit),
      side: unit.side,
      fromHexId,
      fromHex: hexLabel(fromHexId),
      toHexId: hexId,
      toHex: hexLabel(hexId),
      route: routeTrainingSnapshot({ path, remaining: 0 }),
      disrupted: unit.disrupted,
      result: task.result || null,
    });
  }

  function finishRetreatTask() {
    const task = app.state.retreatTask;
    if (!task) return;
    const battle = battleById(task.battleId) || task.battle;
    if (battle) {
      battle.resolved = true;
      archiveBattleReport(battle);
    }
    app.state.retreatTask = null;
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
    if (task.advanceAfter && battle) startAdvanceTask(battle);
    markCombatCompleteOnce();
    draw();
  }

  function startAdvanceTask(battle) {
    const targetHexId = battle.defenderHexId;
    if (liveUnitAt(targetHexId)) return;
    const eligible = battle.attackerIds.filter((id) => {
      const unit = unitById(id);
      return unit && !unit.eliminated && neighborsOf(unit.hexId).includes(targetHexId);
    });
    if (!eligible.length) return;
    app.state.advanceTask = { battleId: battle.id, targetHexId, attackerIds: eligible };
  }

  async function advanceUnit(unitId) {
    const task = app.state.advanceTask;
    if (isOnlineMatch()) {
      if (!task) return;
      await submitOnlineGameAction(unitId === "skip"
        ? { type: app.core.ENV_ACTION.SKIP_ADVANCE, battleId: task.battleId, targetHexId: task.targetHexId }
        : { type: app.core.ENV_ACTION.ADVANCE_UNIT, unitId, battleId: task.battleId, targetHexId: task.targetHexId });
      return;
    }
    const eventStateBefore = clone(app.state);
    const trainingEntry = advanceTrainingEntry(unitId);
    recordHumanDemonstrationDecision(
      unitId === "skip"
        ? { type: app.core.ENV_ACTION.SKIP_ADVANCE, battleId: task?.battleId, targetHexId: task?.targetHexId }
        : { type: app.core.ENV_ACTION.ADVANCE_UNIT, unitId, battleId: task?.battleId, targetHexId: task?.targetHexId },
      eventStateBefore,
    );
    if (!task || unitId === "skip") {
      recordTrainingEntry(trainingEntry);
      app.state.advanceTask = null;
      if (task) {
        recordTrainingEvent("UNIT_ADVANCED", eventStateBefore, {
          battleId: task.battleId,
          targetHexId: task.targetHexId,
          targetHex: hexLabel(task.targetHexId),
          unitId: "skip",
          skipped: true,
        });
      }
      draw();
      return;
    }
    const unit = unitById(unitId);
    if (unit && !unit.eliminated && !liveUnitAt(task.targetHexId)) {
      const fromHexId = unit.hexId;
      await animateUnitPath(unit, [unit.hexId, task.targetHexId]);
      unit.hexId = task.targetHexId;
      addBattleEvent(task.battleId, { type: "advance", unitId: unit.id, toHexId: task.targetHexId, text: tr("text.advance", { unit: unitName(unit), hex: hexLabel(task.targetHexId) }) });
      recordTrainingEntry(trainingEntry);
      log(tr("text.advance", { unit: unitName(unit), hex: hexLabel(task.targetHexId) }));
      recordTrainingEvent("UNIT_ADVANCED", eventStateBefore, {
        battleId: task.battleId,
        unitId: unit.id,
        unit: unitTrainingSnapshot(unit),
        side: unit.side,
        fromHexId,
        fromHex: hexLabel(fromHexId),
        toHexId: task.targetHexId,
        toHex: hexLabel(task.targetHexId),
      });
    }
    app.state.advanceTask = null;
    markCombatCompleteOnce();
    draw();
  }

  function legalRetreatPaths(unit, requiredSteps, originHexId) {
    const result = new Map();
    const maxSteps = Math.min(app.hexes.length, requiredSteps + 18);
    const seen = new Set();
    const queue = [{ hexId: unit.hexId, steps: 0, requiredSteps, path: [unit.hexId] }];
    while (queue.length) {
      const current = queue.shift();
      const key = `${current.hexId}:${current.steps}:${current.requiredSteps}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const currentDistance = hexDistance(current.hexId, originHexId);
      if (current.steps >= maxSteps) continue;
      for (const nextId of neighborsOf(current.hexId)) {
        const nextHex = hexById(nextId);
        if (!terrainRule(nextHex).passable) continue;
        const occupant = liveUnitAt(nextId);
        if (occupant && occupant.side !== unit.side) continue;
        if (isEnemyZoc(nextId, unit.side, unit.id)) continue;
        if (hexDistance(nextId, originHexId) <= currentDistance) continue;
        const nextSteps = current.steps + 1;
        const friendlyOccupied = occupant && occupant.id !== unit.id && occupant.side === unit.side;
        const nextPath = [...current.path, nextId];
        let nextRequiredSteps = current.requiredSteps;
        if (nextSteps >= nextRequiredSteps && friendlyOccupied) nextRequiredSteps += 1;
        if (nextSteps >= nextRequiredSteps && !friendlyOccupied) {
          if (!result.has(nextId)) result.set(nextId, nextPath);
          continue;
        }
        queue.push({ hexId: nextId, steps: nextSteps, requiredSteps: nextRequiredSteps, path: nextPath });
      }
    }
    return result;
  }

  function legalRetreatDestinations(unit, requiredSteps, originHexId) {
    return new Set(legalRetreatPaths(unit, requiredSteps, originHexId).keys());
  }

  async function attemptMove(destinationHexId) {
    const unit = unitById(app.state.selectedUnitId);
    if (!unit || unit.side !== activeSide() || unit.eliminated) return;
    if (unit.disrupted) {
      log(tr("text.cannotMove", { unit: unitName(unit) }));
      draw();
      return;
    }
    if (app.state.movedUnits.includes(unit.id)) {
      log(tr("text.alreadyMoved", { unit: unitName(unit) }));
      draw();
      return;
    }
    const route = app.reachable.get(destinationHexId);
    if (!route) return;
    const occupant = liveUnitAt(destinationHexId);
    if (occupant && occupant.id !== unit.id) {
      log(tr("text.targetOccupied"));
      draw();
      return;
    }
    const fromHexId = unit.hexId;
    const path = route.path || [fromHexId, destinationHexId];
    if (isOnlineMatch()) {
      await submitOnlineGameAction({
        type: app.core.ENV_ACTION.MOVE_UNIT,
        unitId: unit.id,
        fromHexId,
        toHexId: destinationHexId,
        route: clone(route),
      });
      return;
    }
    const movedUnitsBefore = app.state.movedUnits.slice();
    const eventStateBefore = clone(app.state);
    const trainingEntry = movementTrainingEntry(unit, fromHexId, destinationHexId, route, app.reachable);
    const humanDemonstrationDecision = recordHumanDemonstrationDecision({
      type: app.core.ENV_ACTION.MOVE_UNIT,
      unitId: unit.id,
      fromHexId,
      toHexId: destinationHexId,
      route: clone(route),
    }, eventStateBefore);
    app.reachable.clear();
    await animateUnitPath(unit, path);
    unit.hexId = destinationHexId;
    app.state.movedUnits.push(unit.id);
    app.state.lastMove = {
      unitId: unit.id,
      fromHexId,
      toHexId: destinationHexId,
      path,
      movedUnitsBefore,
      turn: app.state.turn,
      phaseIndex: app.state.phaseIndex,
      ...(PRODUCT_PROFILE.features.humanLabCaptureIntegrity
        ? { humanDemonstrationDecisionId: humanDemonstrationDecision?.id || null }
        : {}),
    };
    recordTrainingEntry(trainingEntry);
    log(tr("text.moved", { unit: unitName(unit), hex: hexLabel(destinationHexId), mp: route.remaining }));
    if (app.core.isAlliedBreakthroughMove(coreContext(), unit, destinationHexId, route.remaining)) {
      setWinner("allied", tr("text.exitWin", { unit: unitName(unit) }), "allied-breakthrough", eventStateBefore);
    }
    recordTrainingEvent("UNIT_MOVED", eventStateBefore, {
      unitId: unit.id,
      unit: unitTrainingSnapshot(unit),
      side: unit.side,
      fromHexId,
      fromHex: hexLabel(fromHexId),
      toHexId: destinationHexId,
      toHex: hexLabel(destinationHexId),
      route: routeTrainingSnapshot(route),
      remainingMovement: route.remaining,
    });
    if (app.state.winner) recordGameEndedEvent(eventStateBefore, { causedBy: "UNIT_MOVED", unitId: unit.id });
    app.state.selectedUnitId = unit.id;
    draw();
  }

  async function undoLastMove() {
    const move = app.state.lastMove;
    const unit = unitById(move?.unitId);
    if (!canUndoLastMove(unit)) return;
    const reversePath = (move.path || [move.fromHexId, move.toHexId]).slice().reverse();
    app.reachable.clear();
    await animateUnitPath(unit, reversePath);
    if (PRODUCT_PROFILE.features.humanLabCaptureIntegrity && move.humanDemonstrationDecisionId) {
      try {
        app.aiHumanRecorder?.tombstoneDecision(move.humanDemonstrationDecisionId, {
          reason: "undo_move",
          stateHash: humanDemonstrationStateHash(app.state),
        });
      } catch (error) {
        console.warn("Human-lab undo tombstone failed closed.", error);
        draw();
        return;
      }
    }
    unit.hexId = move.fromHexId;
    app.state.movedUnits = move.movedUnitsBefore || app.state.movedUnits.filter((id) => id !== unit.id);
    app.state.selectedUnitId = unit.id;
    app.state.lastMove = null;
    log(tr("text.undoMoved", { unit: unitName(unit), hex: hexLabel(move.fromHexId) }));
    draw();
  }

  function reachableHexes(unit) {
    const allowance = movementAllowance(unit);
    const startHexId = unit.hexId;
    const result = new Map();
    const queue = [{ hexId: startHexId, spent: 0, firstStep: true, path: [startHexId] }];
    const bestSpent = new Map([[startHexId, 0]]);
    while (queue.length) {
      const current = queue.shift();
      const currentInZoc = isEnemyZoc(current.hexId, unit.side, unit.id);
      if (!current.firstStep && currentInZoc) continue;
      for (const nextId of neighborsOf(current.hexId)) {
        const nextHex = hexById(nextId);
        const rule = terrainRule(nextHex);
        if (!rule.passable) continue;
        const occupant = liveUnitAt(nextId);
        if (occupant && occupant.side !== unit.side) continue;
        const nextInZoc = isEnemyZoc(nextId, unit.side, unit.id);
        if (currentInZoc && nextInZoc) continue;
        const spent = current.spent + Number(rule.movement || 1);
        if (spent > allowance) continue;
        if (bestSpent.has(nextId) && bestSpent.get(nextId) <= spent) continue;
        bestSpent.set(nextId, spent);
        const remaining = allowance - spent;
        const path = current.path.concat(nextId);
        if (!occupant || occupant.id === unit.id) result.set(nextId, { spent, remaining, path });
        queue.push({ hexId: nextId, spent, firstStep: false, path });
      }
    }
    result.delete(startHexId);
    return result;
  }

  function movementAllowance(unit) {
    let movement = unit.movement;
    if (unit.side === "allied" && app.state.turn === 1) {
      movement = Math.max(1, Math.floor(movement * app.rules.firstTurnAlliedMovementMultiplier));
    }
    return movement;
  }

  function isEnemyZoc(hexId, friendlySide, ignoreUnitId = null) {
    return liveUnits().some((unit) => {
      if (unit.id === ignoreUnitId || unit.side === friendlySide || unit.disrupted) return false;
      return neighborsOf(unit.hexId).includes(hexId);
    });
  }

  function isSideZoc(hexId, side, ignoreUnitId = null) {
    return liveUnits().some((unit) => {
      if (unit.id === ignoreUnitId || unit.side !== side || unit.disrupted) return false;
      return neighborsOf(unit.hexId).includes(hexId);
    });
  }

  function neighborsOf(hexId) {
    if (!hexId) return [];
    const cached = app.neighborCache.get(hexId);
    if (cached) return cached;
    const neighbors = app.core?.neighborsOf
      ? app.core.neighborsOf(app.board, hexId)
      : [];
    app.neighborCache.set(hexId, neighbors);
    return neighbors;
  }

  function hexDistance(fromId, toId) {
    if (fromId === toId) return 0;
    if (!fromId || !toId) return Infinity;
    const key = fromId < toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
    if (app.distanceCache.has(key)) return app.distanceCache.get(key);
    const distance = app.core?.hexDistance
      ? app.core.hexDistance(app.board, fromId, toId)
      : Infinity;
    app.distanceCache.set(key, distance);
    return distance;
  }

  function isAiSide(side) {
    if (isOnlineMatch()) return false;
    return Boolean(app.ai.mode !== "hotseat" && side && side !== app.ai.humanSide);
  }

  function isAiTurn() {
    return Boolean(app.state && !app.state.winner && isAiSide(activeSide()));
  }

  function currentRetreatUnit() {
    const task = app.state?.retreatTask;
    return task ? unitById(task.unitIds[task.index]) : null;
  }

  function retreatControllerSide(task = app.state?.retreatTask) {
    return task?.controllerSide || task?.battle?.side || battleById(task?.battleId)?.side || activeSide();
  }

  function hasAiControlledTask() {
    if (!app.state || app.state.winner) return false;
    if (app.state.retreatTask) return isAiSide(retreatControllerSide());
    if (app.state.advanceTask) return isAiSide(activeSide());
    return false;
  }

  function isHumanInputBlocked() {
    if (isOnlineMatch()) {
      const clientState = onlineClientState();
      const room = clientState?.room;
      return Boolean(
        room?.status !== "active"
        || clientState?.connection !== "connected"
        || clientState?.operation
        || app.online.submitting
        || clientState?.playerSide !== room?.activeSide
      );
    }
    return Boolean(app.ai.running || isAiTurn() || hasAiControlledTask());
  }

  function scheduleAiTurn() {
    if (isOnlineMatch()) return;
    if (!app.state || app.state.winner || app.ai.running || app.ai.scheduled) return;
    if (el.body.dataset.view !== "game") return;
    if (app.ai.waitingForHuman && !hasAiControlledTask()) return;
    if (!isAiTurn() && !hasAiControlledTask()) return;
    app.ai.scheduled = true;
    window.setTimeout(runAiTurn, isMovementPhase() ? 14 : 180);
  }

  async function runAiTurn() {
    if (app.ai.running) return;
    app.ai.scheduled = false;
    if (!app.state || app.state.winner || el.body.dataset.view !== "game") return;
    app.ai.running = true;
    draw();
    try {
      await delay(isMovementPhase() ? 14 : 180);
      const handledTask = await resolveAiPendingTasks({ force: isAiTurn() });
      if (handledTask && isAiTurn() && !app.state.winner) {
        app.ai.waitingForHuman = true;
        return;
      }
      if (app.ai.waitingForHuman || !isAiTurn() || app.state.winner) return;
      if (isMovementPhase()) await runAiMovementPhase();
      else if (isCombatPhase() && app.state.combatMode !== "declare") app.ai.waitingForHuman = true;
      else if (isCombatPhase() && app.state.combatMode === "declare") await runAiCombatPhase();
    } finally {
      app.ai.running = false;
      draw();
    }
  }

  async function resolveAiPendingTasks(options = {}) {
    let guard = 0;
    let handled = false;
    while (app.state && !app.state.winner && guard < 80) {
      guard += 1;
      if (app.state.retreatTask) {
        const unit = currentRetreatUnit();
        if (!unit) {
          prepareCurrentRetreat({ silent: true });
          continue;
        }
        if (!options.force && !isAiSide(retreatControllerSide())) return handled;
        const destination = chooseAiRetreatDestination(unit);
        if (!destination) return handled;
        await chooseRetreatHex(destination);
        handled = true;
        await delay(360);
        continue;
      }
      if (app.state.advanceTask) {
        if (!options.force && !isAiSide(activeSide())) return handled;
        await advanceUnit(chooseAiTacticalAdvanceUnit() || chooseAiAdvanceUnit() || "skip");
        handled = true;
        await delay(360);
        continue;
      }
      return handled;
    }
    return handled;
  }

  async function runAiMovementPhase() {
    let moved = 0;
    const side = activeSide();
    const deadline = Date.now() + AI_MOVEMENT_PHASE_TIME_BUDGET_MS;
    app.ai.movementPlan = buildAiOperationalPlan(side);
    moved += await executeAiAlphaMovementPlan(side, deadline);
    const units = liveUnits()
      .filter((unit) => unit.side === side && !unit.disrupted)
      .sort((a, b) => aiMovePriority(b) - aiMovePriority(a) || String(a.id).localeCompare(String(b.id)));
    if (!aiDeadlineExpired(deadline)) {
      moved += await executeAiMovementPhasePlan(chooseAiMovementPhasePlan(side), side, deadline);
    }

    for (const unit of units) {
      if (aiDeadlineExpired(deadline)) break;
      if (app.state.winner || !isAiTurn()) break;
      if (app.state.movedUnits.includes(unit.id) || unit.eliminated) continue;
      app.ai.movementPlan = buildAiOperationalPlan(side);
      app.state.selectedUnitId = unit.id;
      app.reachable.clear();
      drawAnimationFrame();
      await yieldToBrowser();
      const order = await chooseAiMove(unit, { deadline });
      if (!order) continue;
      app.reachable = new Map([[order.hexId, order.route]]);
      await attemptMove(order.hexId);
      moved += 1;
      await delay(6);
    }

    app.state.selectedUnitId = null;
    app.reachable.clear();
    app.ai.movementPlan = null;
    log(moved ? tr("text.aiMovementDone", { side: sideLabel(side) }) : tr("text.aiNoMove"));
    app.ai.waitingForHuman = true;
    draw();
  }

  function chooseAiMovementPhasePlan(side) {
    if (!app.aiPhaseSearch?.beamSearchMovementPhase) return null;
    const environment = aiSearchEnvironment();
    if (!environment) return null;
    try {
      return app.aiPhaseSearch.beamSearchMovementPhase(environment, {
        side,
        beamWidth: 10,
        candidateLimit: 20,
        maxActions: 5,
        nodeLimit: 72,
        timeBudgetMs: 190,
        minNodes: 16,
        projectionCandidateLimit: 10,
        projectionBeamLimit: 3,
        weights: app.aiWeights?.phaseSearch || null,
      });
    } catch (error) {
      console.warn("AI phase search failed; falling back to unit heuristics.", error);
      return null;
    }
  }

  async function executeAiMovementPhasePlan(plan, side, deadline = 0) {
    if (!plan?.actions?.length) return 0;
    let moved = 0;
    for (const action of plan.actions) {
      if (aiDeadlineExpired(deadline)) break;
      if (app.state.winner || !isAiTurn() || activeSide() !== side) break;
      if (action.type !== app.core?.ENV_ACTION?.MOVE_UNIT) continue;
      const unit = unitById(action.unitId);
      if (!unit || unit.eliminated || unit.disrupted || unit.side !== side || app.state.movedUnits.includes(unit.id)) continue;
      const reachable = reachableHexes(unit);
      const route = reachable.get(action.toHexId);
      if (!route) continue;
      app.state.selectedUnitId = unit.id;
      app.reachable = new Map([[action.toHexId, route]]);
      drawAnimationFrame();
      await yieldToBrowser();
      await attemptMove(action.toHexId);
      moved += 1;
      await delay(6);
    }
    return moved;
  }

  async function executeAiAlphaMovementPlan(side, deadline = 0) {
    if (!app.core?.ENV_ACTION) return 0;
    let moved = 0;
    let guard = 0;
    while (guard < 1 && !aiDeadlineExpired(deadline) && app.state && !app.state.winner && isAiTurn() && activeSide() === side) {
      guard += 1;
      const action = await chooseAiAlphaAction({
        iterations: 6,
        maxDepth: 1,
        actionLimit: 6,
        preApplyLimit: 18,
        timeBudgetMs: 45,
      });
      if (!action || action.type === app.core.ENV_ACTION.END_PHASE) break;
      if (action.type !== app.core.ENV_ACTION.MOVE_UNIT) break;
      const unit = unitById(action.unitId);
      if (!unit || unit.eliminated || unit.disrupted || unit.side !== side || app.state.movedUnits.includes(unit.id)) break;
      const reachable = reachableHexes(unit);
      const route = reachable.get(action.toHexId);
      if (!route) break;
      app.state.selectedUnitId = unit.id;
      app.reachable = new Map([[action.toHexId, route]]);
      drawAnimationFrame();
      await yieldToBrowser();
      await attemptMove(action.toHexId);
      moved += 1;
      await delay(6);
    }
    return moved;
  }

  async function runAiCombatPhase() {
    const declared = await declareAiCombats();
    if (!declared) log(tr("text.aiNoCombat"));
    app.ai.waitingForHuman = true;
    draw();
  }

  async function chooseAiMove(unit, options = {}) {
    const reachable = reachableHexes(unit);
    if (!reachable.size) return null;
    const tacticalMove = chooseAiTacticalMove(unit, reachable);
    if (tacticalMove) return tacticalMove;
    if (unit.side === "axis") {
      const guardMove = chooseAxisExitGuardMove(unit, reachable);
      if (guardMove === "hold") return null;
      if (guardMove) return { hexId: guardMove, route: reachable.get(guardMove), reachable };
    }
    app.ai.movementPlan = buildAiOperationalPlan(unit.side);
    const scoreContext = buildAiMoveScoreContext(unit);
    const currentRoute = { remaining: movementAllowance(unit), path: [unit.hexId] };
    const currentScore = scoreAiHex(unit, unit.hexId, currentRoute, scoreContext) + roughAiMoveScore(unit, unit.hexId, currentRoute) * 0.06;
    let best = null;
    let scored = 0;
    for (const candidate of prioritizedAiMoveCandidates(unit, reachable)) {
      const detailed = scoreAiHex(unit, candidate.hexId, candidate.route, scoreContext);
      const score = detailed + candidate.rough * 0.06;
      if (!best || score > best.score) best = { hexId: candidate.hexId, route: candidate.route, score };
      scored += 1;
      if (scored % AI_SCORE_BATCH_SIZE === 0) {
        await yieldToBrowser();
        if (aiDeadlineExpired(options.deadline)) return null;
        if (!app.state || app.state.winner || !isAiTurn() || unit.eliminated) return null;
      }
    }
    if (!best || best.score <= currentScore + aiRoughMoveThreshold(unit)) return null;
    return { hexId: best.hexId, route: best.route, reachable };
  }

  function chooseAiTacticalMove(unit, reachable) {
    if (!app.aiTactics?.findImmediateTacticalAction || !app.aiTactics?.filterImmediateMovementTacticalActions || !app.core?.ENV_ACTION) return null;
    const actions = Array.from(reachable.entries()).map(([hexId, route]) => ({
      type: app.core.ENV_ACTION.MOVE_UNIT,
      unitId: unit.id,
      fromHexId: unit.hexId,
      toHexId: hexId,
      route,
    }));
    const tacticalActions = app.aiTactics.filterImmediateMovementTacticalActions(actions, {
      side: unit.side,
      axisObjectiveHexIds: axisObjectiveHexes(),
      alliedExitHexIds: app.scenario.objectives.alliedWestExitEdge,
    });
    if (!tacticalActions.length) return null;
    const environment = aiSearchEnvironment();
    if (!environment) return null;
    const tactical = app.aiTactics.findImmediateTacticalAction(environment, tacticalActions, { side: unit.side });
    if (!tactical || tactical.action?.type !== app.core.ENV_ACTION.MOVE_UNIT) return null;
    const route = reachable.get(tactical.action.toHexId);
    return route ? { hexId: tactical.action.toHexId, route, reachable, tacticalReason: tactical.reason } : null;
  }

  function buildAiMoveScoreContext(unit) {
    return {
      operationalPlan: currentAiMovementPlan(unit.side),
      axisCurrentOvermass: unit.side === "axis" ? axisLocalAttackOvermassScore(unit, unit.hexId) : 0,
    };
  }

  function prioritizedAiMoveCandidates(unit, reachable) {
    return Array.from(reachable.entries())
      .map(([hexId, route]) => ({ hexId, route, rough: roughAiMoveScore(unit, hexId, route) }))
      .sort((a, b) => b.rough - a.rough || String(a.hexId).localeCompare(String(b.hexId)))
      .slice(0, aiMoveCandidateLimit(unit));
  }

  function aiMoveCandidateLimit(unit) {
    const movement = Number(unit.movement || 0);
    if (unit.side === "axis" && movement >= 9) return 3;
    if (unit.side === "allied" && movement >= 7) return 5;
    if (unit.side === "allied") return 4;
    if (movement >= 7) return 3;
    return 2;
  }

  function aiRoughMoveThreshold(unit) {
    if (unit.side === "axis") return Number(unit.movement || 0) >= 9 ? 20 : 16;
    return Number(unit.movement || 0) >= 7 ? 18 : 14;
  }

  function roughAiMoveScore(unit, hexId, route = null) {
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const targets = unit.side === "axis" ? axisUnitTargetHexes(unit) : alliedAnchorHexes();
    const currentDistance = nearestDistance(unit.hexId, targets);
    const candidateDistance = nearestDistance(hexId, targets);
    const progress = currentDistance - candidateDistance;
    let score = progress * (unit.side === "axis" ? (movement >= 9 ? 120 : 74) : 72);
    score += Number(route?.remaining || 0) * (movement >= 9 ? 2.2 : 1.4);

    if (unit.side === "axis") {
      score += axisObjectiveScore(hexId) * 14;
      if (candidateDistance <= 2) score += (3 - candidateDistance) * (movement >= 9 ? 180 : 92);
      const fastEncirclement = axisFastEncirclementScore(unit, hexId, route);
      const fastOvermass = axisFastOvermassPenalty(unit, hexId);
      score += fastEncirclement;
      score += axisSpearheadPlaybookMoveScore(unit, hexId, route, fastEncirclement, fastOvermass);
      score += axisOperationalPlanMoveScoreForUnit(unit, hexId, route) * 0.48;
      score -= fastOvermass;
      if (nearestDistance(hexId, app.scenario.objectives.alliedWestExitEdge) <= 1 && isAxisAssaultUnit(unit)) score -= 240;
    } else {
      const objectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
      if (objectiveDistance >= 4 && objectiveDistance <= 8) score += 170 - Math.abs(6 - objectiveDistance) * 18;
      if (objectiveDistance <= 1) score -= app.state.turn <= 3 ? 150 : 40;
      score += alliedDefenseScore(hexId) * 10;
      score += alliedOperationalPlanMoveScoreForUnit(unit, hexId) * 0.5;
    }

    for (const neighborId of neighborsOf(hexId)) {
      const enemy = liveUnitAt(neighborId);
      if (!enemy || enemy.side === unit.side || enemy.disrupted) continue;
      score += Number(enemy.combat || 0) * (unit.side === "axis" ? 34 : 26) + combat * 8;
    }
    return score;
  }

  function chooseAxisExitGuardMove(unit, reachable) {
    const westExit = app.scenario.objectives.alliedWestExitEdge;
    if (isAxisAssaultUnit(unit)) return null;
    const maxExitThreat = Math.max(0, ...westExit.map((hexId) => alliedExitThreat(hexId)));
    if (maxExitThreat < 12 && nearestDistance(unit.hexId, westExit) > 1) return null;
    const holdThreat = 11;
    if (westExit.includes(unit.hexId) && alliedExitThreat(unit.hexId) >= holdThreat) return "hold";
    let best = null;
    for (const [hexId, route] of reachable.entries()) {
      const coverage = axisExitCoverageScore(hexId, unit.id);
      if (!coverage) continue;
      const score = coverage + Number(route?.remaining || 0) * 0.3 - nearestDistance(unit.hexId, [hexId]) * 0.4;
      if (!best || score > best.score) best = { hexId, score };
    }
    return best && best.score >= 24 ? best.hexId : null;
  }

  function isAxisAssaultUnit(unit) {
    return unit?.side === "axis" && Number(unit.movement || 0) >= 9 && Number(unit.combat || 0) >= 4;
  }

  function aiMovePriority(unit) {
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const objectivePressure = unit.side === "axis"
      ? Math.max(0, 18 - nearestDistance(unit.hexId, axisUnitTargetHexes(unit))) * 0.8
      : Math.max(0, 12 - nearestDistance(unit.hexId, alliedAnchorHexes())) * 0.5;
    const reliefPriority = unit.side === "allied" && alliedShouldRelieveObjectiveDefender(unit) ? 55 : 0;
    return movement * 1.7 + combat * 1.2 + objectivePressure + reliefPriority;
  }

  function currentAiMovementPlan(side) {
    if (
      app.ai.movementPlan
      && app.ai.movementPlan.side === side
      && app.ai.movementPlan.turn === app.state.turn
      && app.ai.movementPlan.phaseIndex === app.state.phaseIndex
    ) {
      return app.ai.movementPlan;
    }
    app.ai.movementPlan = buildAiOperationalPlan(side);
    return app.ai.movementPlan;
  }

  function buildAiOperationalPlan(side) {
    const units = liveUnits().filter((unit) => unit.side === side && !unit.disrupted);
    if (side === "axis") {
      const focusObjectiveHex = axisFocusObjectiveHex();
      const westExitThreat = Math.max(0, ...app.scenario.objectives.alliedWestExitEdge.map((hexId) => alliedExitThreat(hexId)));
      const ranked = units
        .filter((unit) => Number(unit.movement || 0) >= 6 || Number(unit.combat || 0) >= 3)
        .sort((a, b) => (
          Number(b.movement || 0) * 2.2 + Number(b.combat || 0) * 1.7 + (isAxisAssaultUnit(b) ? 16 : 0)
        ) - (
          Number(a.movement || 0) * 2.2 + Number(a.combat || 0) * 1.7 + (isAxisAssaultUnit(a) ? 16 : 0)
        ));
      const spearheadUnitIds = new Set(ranked.slice(0, Math.max(5, Math.min(8, ranked.length))).map((unit) => unit.id));
      return {
        side,
        turn: app.state.turn,
        phaseIndex: app.state.phaseIndex,
        focusObjectiveHex,
        spearheadUnitIds,
        westExitThreat,
      };
    }

    const axisAssaultUnits = liveUnits()
      .filter((unit) => isAxisAssaultUnit(unit) && !unit.disrupted)
      .sort((a, b) => nearestDistance(a.hexId, axisObjectiveHexes()) - nearestDistance(b.hexId, axisObjectiveHexes()));
    const wallUnitIds = new Set(units
      .filter((unit) => Number(unit.combat || 0) >= 2 || Number(unit.movement || 0) >= 7)
      .sort((a, b) => Number(b.combat || 0) * 1.4 + Number(b.movement || 0) - (Number(a.combat || 0) * 1.4 + Number(a.movement || 0)))
      .slice(0, Math.max(6, Math.min(10, units.length)))
      .map((unit) => unit.id));
    return {
      side,
      turn: app.state.turn,
      phaseIndex: app.state.phaseIndex,
      focusObjectiveHex: axisFocusObjectiveHex(),
      axisSpearheadIds: new Set(axisAssaultUnits.slice(0, 6).map((unit) => unit.id)),
      wallUnitIds,
    };
  }

  function scoreAiHex(unit, hexId, route = null, scoreContext = null) {
    const hex = hexById(hexId);
    if (!hex) return -Infinity;
    const side = unit.side;
    const combat = Number(unit.combat || 0);
    let score = 0;

    if (side === "axis") {
      const targets = axisUnitTargetHexes(unit);
      const assault = isAxisAssaultUnit(unit);
      score += axisObjectiveScore(hexId) * 4.4;
      score += axisFinalObjectiveEntryScore(unit, hexId);
      score += axisObjectiveEntrySecurityScore(unit, hexId);
      score += axisBridgeheadSecurityScore(unit, hexId) * (assault ? 1.18 : combat >= 3 ? 0.9 : 0.45);
      score += axisFocusedObjectiveSupportScore(unit, hexId) * (assault ? 1.25 : combat >= 2 ? 1 : 0.5);
      score -= nearestDistance(hexId, targets) * (combat >= 4 ? 6.1 : 3.5);
      score += axisProgressScore(unit, hexId) * (assault ? 1.35 : 1);
      score += axisForwardZocLineScore(unit, hexId) * (assault ? 1.45 : combat >= 3 ? 2.25 : 1);
      score += assault ? 0 : axisRearGuardScore(unit, hexId);
      score += assault ? 0 : axisForwardScreenTempoScore(unit, hexId);
      score += attackSetupScore(unit, hexId) * (assault ? 3.9 : 3.1);
      score += zocTrapSetupScore(unit, hexId) * (assault ? 9.4 : 6.6);
      const fastEncirclement = axisFastEncirclementScore(unit, hexId, route);
      const fastOvermass = axisFastOvermassPenalty(unit, hexId);
      score += fastEncirclement * (assault ? 0.72 : combat >= 3 ? 0.48 : 0.25);
      score += axisSpearheadPlaybookMoveScore(unit, hexId, route, fastEncirclement, fastOvermass) * (assault ? 0.82 : 0.48);
      score += axisOperationalPlanMoveScoreForUnit(unit, hexId, route, scoreContext) * (assault ? 0.72 : 0.5);
      score -= fastOvermass * (assault ? 0.5 : 0.35);
      score -= axisLocalAttackOvermassScore(unit, hexId) * (assault ? 1.22 : 1);
      score += axisSurplusBreakthroughScore(unit, hexId, route, scoreContext) * (assault ? 1.18 : combat >= 3 ? 0.82 : 0.32);
      if (assault) {
        score += axisPenetrationScore(unit, hexId, route);
        score += axisEncirclementScore(unit, hexId, route);
        score += axisObjectiveAttackPositionScore(unit, hexId);
        score += axisFinalAssaultMassScore(unit, hexId);
        score += axisFinalApproachTempoScore(unit, hexId);
        score += axisMobileGroupSupportScore(unit, hexId);
        score += axisSpearheadPressureScore(unit, hexId);
      }
      else {
        score += axisZocScreenScore(unit, hexId);
        score += axisDynamicScreenScore(unit, hexId);
      }
      if (assault && app.scenario.objectives.alliedWestExitEdge.includes(hexId)) score -= 110;
    } else {
      if (app.scenario.objectives.alliedWestExitEdge.includes(hexId) && route?.remaining > 0) {
        score += isEnemyZoc(hexId, side, unit.id) ? 24 : 230;
      }
      score += alliedDefenseScore(hexId) * 2.65;
      score += alliedScreenScore(hexId) * 4.1;
      score += alliedForwardDefenseScore(unit, hexId) * (combat >= 4 ? 1.05 : 0.82);
      score += alliedZocBarrierScore(unit, hexId) * (combat >= 4 ? 1.45 : 1.15);
      score += alliedInterlockingZocScore(unit, hexId) * (combat >= 4 ? 1.5 : 1.18);
      score += alliedRoadApproachScreenScore(unit, hexId) * (combat >= 3 ? 1.45 : 1.12);
      score += alliedRoadblockScore(unit, hexId) * (combat >= 3 ? 1.1 : 0.9);
      score += alliedObjectiveGateLatchScore(unit, hexId) * (combat >= 3 ? 1.18 : 0.92);
      score += alliedFinalGateScreenScore(unit, hexId) * (combat >= 3 ? 1.45 : 1.06);
      score += alliedSupportedLineScore(unit, hexId) * 0.78;
      score += alliedApproachInterdictionScore(unit, hexId) * 1.28;
      score += alliedForwardScreenLineScore(unit, hexId) * (combat >= 4 ? 1.32 : 1.06);
      score += alliedForwardZocWallScore(unit, hexId) * (combat >= 3 ? 2.7 : 1.95);
      score += alliedOperationalPlanMoveScoreForUnit(unit, hexId, scoreContext) * (combat >= 3 ? 0.36 : 0.24);
      score += alliedSpearheadCounterattackPositionScore(unit, hexId);
      score -= alliedIsolatedObjectivePenaltyScore(unit, hexId);
      score += alliedRidgeReserveScore(unit, hexId) * (combat >= 4 ? 1.05 : 0.9);
      score += alliedObjectiveHoldScore(unit, hexId);
      score += alliedObjectiveCounterattackScore(unit, hexId) * (combat >= 3 ? 1.1 : 0.75);
      score += alliedObjectiveReliefScore(unit, hexId);
      score += alliedLineCohesionScore(unit, hexId) * 0.8;
      score -= nearestDistance(hexId, alliedAnchorHexes()) * (combat >= 4 ? 1.1 : 0.85);
      score += attackSetupScore(unit, hexId) * 2.2;
      score += zocTrapSetupScore(unit, hexId) * 1.3;
    }

    if (hex.terrain === "highland" || hex.terrain === "settlement") score += 9 + combat * 0.8;
    if (side === "allied" && hex.britishPosition) score += 16 + combat * 0.7;
    score += friendlySupportScore(unit, hexId) * 1.25;
    score -= enemyDangerScore(unit, hexId) * (side === "axis" && isAxisAssaultUnit(unit) ? 0.68 : combat >= 4 ? 0.6 : 1.25);
    if (isEnemyZoc(hexId, side, unit.id)) score += combat >= 4 ? 4.5 : -9;
    score += Number(route?.remaining || 0) * (side === "axis" ? 0.18 : 0.28);
    score += combat * 0.35;
    return score;
  }

  function axisUnitTargetHexes(unit) {
    const objectives = axisObjectiveHexes();
    const bestDistance = nearestDistance(unit.hexId, objectives);
    const spread = Number(unit.movement || 0) >= 9 ? 2 : 1;
    return objectives.filter((hexId) => hexDistance(unit.hexId, hexId) <= bestDistance + spread);
  }

  function axisObjectiveHexes() {
    return [...app.scenario.objectives.alamHalfaRidge, ...app.scenario.objectives.coastalRoadEast];
  }

  function alliedAnchorHexes() {
    return [
      ...app.scenario.objectives.alamHalfaRidge,
      ...app.scenario.objectives.coastalRoadEast,
      ...app.scenario.objectives.alliedWestExitEdge,
    ];
  }

  function nearestDistance(hexId, targets) {
    if (!targets?.length) return Infinity;
    return Math.min(...targets.map((target) => hexDistance(hexId, target)));
  }

  function axisObjectiveScore(hexId) {
    let score = 0;
    if (app.scenario.objectives.alamHalfaRidge.includes(hexId)) score += 60;
    if (app.scenario.objectives.coastalRoadEast.includes(hexId)) score += 32;
    if (hexId === "c12r03") score += 38;
    return score;
  }

  function axisFinalObjectiveEntryScore(unit, hexId) {
    if (unit.side !== "axis" || app.state.turn < 4) return 0;
    const axisAlreadyHoldsObjective = axisObjectiveHexes().some((objectiveHexId) => liveUnitAt(objectiveHexId)?.side === "axis");
    if (axisAlreadyHoldsObjective) return 0;
    if (axisObjectiveHexes().includes(hexId) && liveUnitAt(hexId)?.side !== "allied") {
      return 1800 + Number(unit.combat || 0) * 24 + Number(unit.movement || 0) * 8;
    }
    const openObjectiveDistance = Math.min(...axisObjectiveHexes()
      .filter((objectiveHexId) => liveUnitAt(objectiveHexId)?.side !== "allied")
      .map((objectiveHexId) => hexDistance(hexId, objectiveHexId)));
    if (openObjectiveDistance === 1) return isAxisAssaultUnit(unit) ? 220 : 70;
    return 0;
  }

  function axisObjectiveEntrySecurityScore(unit, hexId) {
    if (unit.side !== "axis" || !axisObjectiveHexes().includes(hexId)) return 0;
    return app.aiHeuristics.objectiveEntrySecurityScore({
      isObjective: true,
      turn: app.state.turn,
      combat: Number(unit.combat || 0),
      supportStrength: sideStrengthWithin("axis", hexId, 2, unit.id),
      adjacentSupportCount: sideUnitsWithin("axis", hexId, 1, unit.id).length,
      counterattackThreat: counterattackThreatAgainstHex("allied", hexId),
    });
  }

  function axisBridgeheadSecurityScore(unit, hexId) {
    if (unit.side !== "axis" || app.state.turn < 3) return 0;
    const units = liveUnits();
    const combat = Number(unit.combat || 0);
    let score = 0;

    for (const objectiveHexId of axisObjectiveHexes()) {
      const occupant = liveUnitAt(objectiveHexId);
      if (occupant?.side === "allied") continue;
      const currentDistance = hexDistance(unit.hexId, objectiveHexId);
      const candidateDistance = hexDistance(hexId, objectiveHexId);
      const securityRadius = app.state.turn >= 4 ? 3 : 2;
      if (candidateDistance > securityRadius && currentDistance > 2) continue;

      const nearbyAllied = units.filter((candidate) => candidate.side === "allied" && !candidate.disrupted && hexDistance(candidate.hexId, objectiveHexId) <= 3);
      const adjacentThreat = nearbyAllied
        .filter((enemy) => hexDistance(enemy.hexId, objectiveHexId) === 1)
        .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
      const closeThreat = nearbyAllied
        .filter((enemy) => hexDistance(enemy.hexId, objectiveHexId) <= 2)
        .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
      const bridgeheadMates = units.filter((ally) => ally.side === "axis" && ally.id !== unit.id && !ally.disrupted && hexDistance(ally.hexId, objectiveHexId) <= 2);
      const interlocks = bridgeheadMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2 || hexDistance(hexId, ally.hexId) === 1).length;
      const held = occupant?.side === "axis";
      const pressure = adjacentThreat * 2.4 + closeThreat + nearbyAllied.length * 4;
      score += app.aiHeuristics.bridgeheadSupportScore({
        turn: app.state.turn,
        hexToObjective: candidateDistance,
        objectiveHeld: held,
        currentSupportCount: bridgeheadMates.length,
        alliedThreat: adjacentThreat + closeThreat * 0.35,
        combat,
        movement: Number(unit.movement || 0),
        lineLinks: interlocks,
      });

      if (held && occupant.id === unit.id && candidateDistance > 0) score -= 10000;
      if (candidateDistance === 0) score += (held ? 110 : 155) + pressure * 5.4 + combat * 7;
      else if (candidateDistance === 1) score += (held ? 135 : 92) + pressure * 4.1 + combat * 5 + interlocks * 18;
      else if (candidateDistance === 2) score += (held ? 48 : 26) + pressure * 1.8 + interlocks * 8;
      else if (candidateDistance === 3 && app.state.turn >= 4) score += (held ? 24 : 14) + pressure * 0.8 + interlocks * 5;

      if (candidateDistance < currentDistance) score += Math.min(30, (currentDistance - candidateDistance) * 12);
      if (currentDistance <= 1 && candidateDistance > currentDistance) score -= held ? 210 : 120;
    }

    return Math.min(560, Math.max(-10000, score));
  }

  function axisFocusedObjectiveSupportScore(unit, hexId) {
    if (unit.side !== "axis" || app.state.turn < 2) return 0;
    const focus = axisFocusObjectiveHex();
    if (!focus) return 0;

    const currentDistance = hexDistance(unit.hexId, focus);
    const candidateDistance = hexDistance(hexId, focus);
    if (currentDistance > 8 && candidateDistance > 5) return 0;

    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const support = sideUnitsWithin("axis", focus, 2, unit.id);
    const supportNeed = Math.max(0, 2 - support.length);
    const progress = currentDistance - candidateDistance;
    const nearestOtherObjective = nearestDistance(hexId, axisObjectiveHexes().filter((objectiveHexId) => objectiveHexId !== focus));
    let score = progress * (isAxisAssaultUnit(unit) ? 18 : combat >= 2 ? 10 : 4);
    if (candidateDistance === 1) score += 58 + supportNeed * 34 + combat * 3.8;
    else if (candidateDistance === 2) score += 38 + supportNeed * 28 + combat * 2.6;
    else if (candidateDistance === 3) score += 18 + supportNeed * 12;
    if (supportNeed > 0 && candidateDistance <= 4 && movement >= 6) score += 22;
    if (app.state.turn >= 3 && supportNeed > 0 && nearestOtherObjective + 2 < candidateDistance) score -= 46;
    if (progress < 0 && supportNeed > 0) score += progress * 18;
    return app.aiHeuristics.clampScore(score, -180, 260);
  }

  function axisFocusObjectiveHex() {
    const heldObjective = axisObjectiveHexes().find((objectiveHexId) => liveUnitAt(objectiveHexId)?.side === "axis");
    if (heldObjective) return heldObjective;
    const assaultUnits = liveUnits().filter((unit) => isAxisAssaultUnit(unit) && !unit.disrupted);
    let best = null;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const nearestAssault = assaultUnits.length
        ? Math.min(...assaultUnits.map((unit) => hexDistance(unit.hexId, objectiveHexId)))
        : Infinity;
      const alliedOccupant = liveUnitAt(objectiveHexId)?.side === "allied";
      const roadBias = app.scenario.objectives.coastalRoadEast.includes(objectiveHexId) ? -0.4 : 0;
      const score = nearestAssault + (alliedOccupant ? 0.8 : 0) + roadBias;
      if (!best || score < best.score) best = { hexId: objectiveHexId, score };
    }
    return best?.hexId || null;
  }

  function axisProgressScore(unit, hexId) {
    const hex = hexById(hexId);
    const start = hexById(unit.hexId);
    if (!hex || !start) return 0;
    const targets = axisUnitTargetHexes(unit);
    const distanceGain = nearestDistance(unit.hexId, targets) - nearestDistance(hexId, targets);
    const eastwardGain = Number(hex.col || 0) - Number(start.col || 0);
    const tempo = Number(unit.movement || 0) >= 9 ? 8.6 : 4.2;
    return distanceGain * tempo + eastwardGain * 0.85;
  }

  function axisPenetrationScore(unit, hexId, route = null) {
    const targets = axisUnitTargetHexes(unit);
    const currentDistance = nearestDistance(unit.hexId, targets);
    const nextDistance = nearestDistance(hexId, targets);
    const distanceGain = currentDistance - nextDistance;
    const inEnemyZoc = isEnemyZoc(hexId, unit.side, unit.id);
    let score = distanceGain * 13;
    if (nextDistance === 0) score += 90;
    else if (nextDistance === 1) score += 34;
    else if (nextDistance === 2) score += 14;
    if (nextDistance <= 5) score += (6 - nextDistance) * 7.5;
    if (!inEnemyZoc && nextDistance <= 5) score += 10;
    if (!inEnemyZoc && Number(route?.remaining || 0) >= 2 && nextDistance <= 6) score += Math.min(3, Number(route.remaining)) * 3.5;
    if (route?.path?.some((id) => liveUnits().some((enemy) => enemy.side === "allied" && !enemy.disrupted && hexDistance(id, enemy.hexId) <= 2))) {
      score += nextDistance <= currentDistance ? 8 : 0;
    }
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      if (!isHighValueAlliedUnit(enemy)) continue;
      const distance = hexDistance(hexId, enemy.hexId);
      if (distance > 3) continue;
      const currentExits = retreatExitCount(enemy, null);
      const trappedExits = retreatExitCount(enemy, { unit, hexId });
      const trapGain = Math.max(0, currentExits - trappedExits);
      score += strategicUnitValueForSide("axis", enemy) * (distance === 1 ? 0.32 : distance === 2 ? 0.18 : 0.09);
      score += trapGain * 9 + Math.max(0, 3 - trappedExits) * 3;
    }
    return score;
  }

  function axisSpearheadPlaybookMoveScore(unit, hexId, route = null, encirclementScore = 0, overmassPenalty = 0) {
    if (unit.side !== "axis") return 0;
    const focus = axisFocusObjectiveHex();
    if (!focus) return 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const lineLinks = liveUnits().filter((ally) => (
      ally.side === "axis"
      && ally.id !== unit.id
      && !ally.disrupted
      && hexDistance(hexId, ally.hexId) === 2
      && hexDistance(ally.hexId, focus) <= 7
    )).length;

    return app.aiHeuristics.axisSpearheadPlaybookScore({
      turn: app.state.turn,
      currentFocusDistance: hexDistance(unit.hexId, focus),
      candidateFocusDistance: hexDistance(hexId, focus),
      currentObjectiveDistance: nearestDistance(unit.hexId, axisObjectiveHexes()),
      candidateObjectiveDistance: nearestDistance(hexId, axisObjectiveHexes()),
      movement,
      combat,
      isAssault: isAxisAssaultUnit(unit),
      encirclementScore,
      lineLinks,
      remainingMovement: Number(route?.remaining || 0),
      overmassPenalty,
    });
  }

  function axisOperationalPlanMoveScoreForUnit(unit, hexId, route = null, scoreContext = null) {
    if (unit.side !== "axis") return 0;
    const plan = scoreContext?.operationalPlan || currentAiMovementPlan("axis");
    const focus = plan?.focusObjectiveHex || axisFocusObjectiveHex();
    if (!focus) return 0;

    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const role = plan.spearheadUnitIds?.has(unit.id)
      ? "spearhead"
      : combat >= 3 || movement >= 6
        ? "support"
        : "screen";
    const mates = liveUnits().filter((ally) => ally.side === "axis" && ally.id !== unit.id && !ally.disrupted);
    const lineLinks = mates.filter((ally) => hexDistance(hexId, ally.hexId) === 2 && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 12).length;
    const adjacentCrowd = mates.filter((ally) => hexDistance(hexId, ally.hexId) === 1 && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 12).length;
    const pocket = bestAxisOperationalPocket(unit, hexId, focus);
    const localOvermass = scoreContext?.axisCurrentOvermass ?? axisLocalAttackOvermassScore(unit, unit.hexId);

    return app.aiHeuristics.axisOperationalPlanMoveScore({
      turn: app.state.turn,
      role,
      currentFocusDistance: hexDistance(unit.hexId, focus),
      candidateFocusDistance: hexDistance(hexId, focus),
      currentObjectiveDistance: nearestDistance(unit.hexId, axisObjectiveHexes()),
      candidateObjectiveDistance: nearestDistance(hexId, axisObjectiveHexes()),
      movement,
      combat,
      lineLinks,
      adjacentCrowd,
      currentTrapExits: pocket.currentTrapExits,
      candidateTrapExits: pocket.candidateTrapExits,
      targetValue: pocket.targetValue,
      localOvermass,
      westExitDistance: nearestDistance(hexId, app.scenario.objectives.alliedWestExitEdge),
      westExitThreat: plan?.westExitThreat || 0,
      inEnemyZoc: isEnemyZoc(hexId, unit.side, unit.id),
      ownEscapeExits: retreatExitCount({ ...unit, hexId }, { unit, hexId }),
    });
  }

  function bestAxisOperationalPocket(unit, hexId, focusObjectiveHex) {
    const hypothetical = { unit, hexId };
    let best = { currentTrapExits: 6, candidateTrapExits: 6, targetValue: 0, score: 0 };
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      if (enemyDistance > 2) continue;
      const currentTrapExits = retreatExitCount(enemy, null);
      const candidateTrapExits = retreatExitCount(enemy, hypothetical);
      const trapGain = Math.max(0, currentTrapExits - candidateTrapExits);
      if (!trapGain && candidateTrapExits > 1) continue;

      const focusDistance = hexDistance(enemy.hexId, focusObjectiveHex);
      const targetValue = strategicUnitValueForSide("axis", enemy)
        + Number(enemy.combat || 0) * 8
        + Math.max(0, 8 - focusDistance) * 5;
      const score = trapGain * 86
        + (candidateTrapExits <= 0 ? 240 : candidateTrapExits === 1 ? 96 : 0)
        + targetValue
        + (enemyDistance === 1 ? 38 : 0);
      if (score > best.score) best = { currentTrapExits, candidateTrapExits, targetValue, score };
    }
    return best;
  }

  function alliedForwardWallPlaybookMoveScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    const zocHexes = [hexId, ...neighborsOf(hexId)];
    let best = 0;
    for (const axisUnit of axisAssaultUnits) {
      for (const objectiveHexId of axisUnitTargetHexes(axisUnit)) {
        const axisToObjective = hexDistance(axisUnit.hexId, objectiveHexId);
        const axisToHex = hexDistance(axisUnit.hexId, hexId);
        const hexToObjective = hexDistance(hexId, objectiveHexId);
        const onApproachLane = axisToHex + hexToObjective <= axisToObjective + 3;
        const lineLinks = liveUnits().filter((ally) => (
          ally.side === "allied"
          && ally.id !== unit.id
          && !ally.disrupted
          && hexDistance(hexId, ally.hexId) === 2
          && hexDistance(ally.hexId, objectiveHexId) >= 3
          && hexDistance(ally.hexId, objectiveHexId) <= 9
        )).length;
        const zocCutsLane = zocHexes.some((zocHexId) => {
          const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
          const zocToObjective = hexDistance(zocHexId, objectiveHexId);
          return zocToAxis >= 1
            && zocToAxis <= 6
            && zocToObjective < axisToObjective
            && zocToAxis + zocToObjective <= axisToObjective + 2;
        });
        best = Math.max(best, app.aiHeuristics.alliedForwardWallPlaybookScore({
          turn: app.state.turn,
          hexToObjective,
          axisToObjective,
          axisToHex,
          onApproachLane,
          lineLinks,
          zocCutsLane,
          combat: Number(unit.combat || 0),
          movement: Number(unit.movement || 0),
          occupiedByAllied: liveUnitAt(objectiveHexId)?.side === "allied",
        }));
      }
    }
    return Math.min(680, best);
  }

  function alliedOperationalPlanMoveScoreForUnit(unit, hexId, scoreContext = null) {
    if (unit.side !== "allied") return 0;
    const plan = scoreContext?.operationalPlan || currentAiMovementPlan("allied");
    const axisSpearheads = Array.from(plan?.axisSpearheadIds || [])
      .map(unitById)
      .filter((candidate) => candidate && !candidate.eliminated && !candidate.disrupted);
    if (!axisSpearheads.length) return 0;

    const role = plan?.wallUnitIds?.has(unit.id)
      ? "wall"
      : Number(unit.combat || 0) >= 4
        ? "counter"
        : "reserve";
    const zocHexes = [hexId, ...neighborsOf(hexId)];
    let best = 0;
    for (const axisUnit of axisSpearheads) {
      for (const objectiveHexId of axisUnitTargetHexes(axisUnit)) {
        const axisToObjective = hexDistance(axisUnit.hexId, objectiveHexId);
        const axisToHex = hexDistance(axisUnit.hexId, hexId);
        const hexToObjective = hexDistance(hexId, objectiveHexId);
        const onApproachLane = axisToHex + hexToObjective <= axisToObjective + 3;
        if (!onApproachLane) continue;

        const alliedMates = liveUnits().filter((ally) => (
          ally.side === "allied"
          && ally.id !== unit.id
          && !ally.disrupted
          && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 10
        ));
        const lineLinks = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
        const adjacentCrowd = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
        const zocCutsLane = zocHexes.some((zocHexId) => {
          const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
          const zocToObjective = hexDistance(zocHexId, objectiveHexId);
          return zocToAxis >= 1
            && zocToAxis <= 6
            && zocToObjective < axisToObjective
            && zocToAxis + zocToObjective <= axisToObjective + 2;
        });
        const currentTrapExits = retreatExitCount(axisUnit, null);
        const candidateTrapExits = retreatExitCount(axisUnit, { unit, hexId });
        best = Math.max(best, app.aiHeuristics.alliedOperationalPlanMoveScore({
          turn: app.state.turn,
          role,
          hexToObjective,
          axisToObjective,
          axisToHex,
          onApproachLane,
          lineLinks,
          adjacentCrowd,
          zocCutsLane,
          combat: Number(unit.combat || 0),
          movement: Number(unit.movement || 0),
          occupiedByAllied: liveUnitAt(objectiveHexId)?.side === "allied",
          counterTrapGain: Math.max(0, currentTrapExits - candidateTrapExits),
        }));
      }
    }
    return Math.min(420, best);
  }

  function axisFastEncirclementScore(unit, hexId, route = null) {
    if (unit.side !== "axis") return 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    if (combat < 3 && movement < 7) return 0;

    const allowance = Math.max(movementAllowance(unit), movement);
    const spent = route ? Math.max(0, allowance - Number(route.remaining || 0)) : 0;
    const efficientMove = !route || spent <= Math.max(5, allowance * 0.82);
    let score = 0;

    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      if (enemyDistance > 2) continue;

      const currentExits = retreatExitCount(enemy, null);
      const trappedExits = retreatExitCount(enemy, { unit, hexId });
      const reduced = Math.max(0, currentExits - trappedExits);
      if (!reduced && trappedExits > 1) continue;

      const adjacent = neighborsOf(enemy.hexId).includes(hexId);
      const defense = Math.max(1, defenseBreakdown(enemy).total);
      const otherAttackStrength = neighborsOf(enemy.hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && !ally.disrupted)
        .reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
      const attackStrength = otherAttackStrength + (adjacent ? combat : 0);
      const value = strategicUnitValueForSide("axis", enemy) + Number(enemy.combat || 0) * 5;
      const sealValue = trappedExits <= 0
        ? 620 + value * 3.6
        : trappedExits === 1
          ? 260 + value * 1.35
          : Math.max(0, 3 - trappedExits) * 64;
      const reductionValue = reduced * (118 + value * 0.45);
      const killReady = attackStrength >= defense * 4
        ? 170
        : attackStrength >= defense * 2
          ? 86
          : attackStrength >= defense
            ? 42
            : 0;
      const distanceFactor = adjacent ? 1.18 : 0.82;
      score += (sealValue + reductionValue + killReady) * distanceFactor * (efficientMove ? 1 : 0.48);
    }

    const objectiveDrift = nearestDistance(hexId, axisObjectiveHexes()) - nearestDistance(unit.hexId, axisObjectiveHexes());
    if (objectiveDrift > 2) score *= 0.42;
    else if (objectiveDrift > 1) score *= 0.58;
    else if (objectiveDrift > 0) score *= 0.78;
    return Math.min(900, score);
  }

  function axisFastOvermassPenalty(unit, hexId) {
    if (unit.side !== "axis") return 0;
    const movement = Number(unit.movement || 0);
    let penalty = 0;
    const hypothetical = { unit, hexId };
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      if (!neighborsOf(enemy.hexId).includes(hexId)) continue;
      const currentExits = retreatExitCount(enemy, null);
      const trappedExits = retreatExitCount(enemy, hypothetical);
      const improvesTrap = trappedExits < currentExits;
      if (improvesTrap) continue;

      const defense = Math.max(1, defenseBreakdown(enemy).total);
      const otherAttackStrength = neighborsOf(enemy.hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && !ally.disrupted)
        .reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
      if (otherAttackStrength >= defense * 4) {
        penalty += 360 + (movement >= 7 ? 220 : 0);
      } else if (trappedExits <= 0 && otherAttackStrength >= defense * 2) {
        penalty += 210 + (movement >= 7 ? 120 : 0);
      }
    }
    return Math.min(1100, penalty);
  }

  function axisEncirclementScore(unit, hexId, route = null) {
    if (unit.side !== "axis") return 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    if (!isAxisAssaultUnit(unit) && combat < 4 && movement < 8) return 0;

    const allowance = Math.max(movementAllowance(unit), movement);
    const spent = route ? Math.max(0, allowance - Number(route.remaining || 0)) : 0;
    const efficientMove = !route || spent <= Math.max(5, allowance * 0.82);
    let score = 0;

    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      if (enemyDistance > 2) continue;

      const currentExits = retreatExitCount(enemy, null);
      const trappedExits = retreatExitCount(enemy, { unit, hexId });
      const reduced = Math.max(0, currentExits - trappedExits);
      if (!reduced && trappedExits > 1) continue;

      const adjacent = neighborsOf(enemy.hexId).includes(hexId);
      const supportStrength = neighborsOf(enemy.hexId)
        .map((neighborId) => (neighborId === hexId ? unit : liveUnitAt(neighborId)))
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && !ally.disrupted)
        .reduce((sum, ally) => sum + Number(ally.combat || 0), adjacent ? combat : 0);
      const defense = Math.max(1, defenseBreakdown(enemy).total);
      const attackReady = adjacent || supportStrength >= defense;
      const value = strategicUnitValueForSide("axis", enemy) + Number(enemy.combat || 0) * 4;
      const killShape = trappedExits === 0
        ? 360 + value * 3.4
        : trappedExits === 1
          ? 150 + value * 1.25
          : Math.max(0, 3 - trappedExits) * 46;
      const reductionValue = reduced * (84 + value * 0.34);
      const attackValue = attackReady ? Math.min(180, (supportStrength / defense) * 44) : 0;
      score += (killShape + reductionValue + attackValue) * (adjacent ? 1.16 : 0.82) * (efficientMove ? 1 : 0.55);
    }

    const objectiveDrift = nearestDistance(hexId, axisObjectiveHexes()) - nearestDistance(unit.hexId, axisObjectiveHexes());
    if (objectiveDrift > 2) score *= 0.42;
    else if (objectiveDrift > 1) score *= 0.58;
    else if (objectiveDrift > 0) score *= 0.78;
    return Math.min(900, score);
  }

  function axisLocalAttackOvermassScore(unit, hexId) {
    if (unit.side !== "axis") return 0;
    const hypothetical = { unit, hexId };
    let penalty = 0;
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      if (!neighborsOf(enemy.hexId).includes(hexId)) continue;
      const otherAttackers = neighborsOf(enemy.hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && !ally.disrupted);
      if (!otherAttackers.length) continue;
      penalty += app.aiHeuristics.localAttackOvermassPenalty({
        attackerSide: "axis",
        candidateCombat: Number(unit.combat || 0),
        candidateMovement: Number(unit.movement || 0),
        defense: defenseBreakdown(enemy).total,
        otherAttackStrength: otherAttackers.reduce((sum, ally) => sum + Number(ally.combat || 0), 0),
        otherAdjacentAttackers: otherAttackers.length,
        trappedExitCount: retreatExitCount(enemy, hypothetical),
        targetObjective: axisObjectiveHexes().includes(enemy.hexId),
      });
    }
    return Math.min(1800, penalty);
  }

  function axisSurplusBreakthroughScore(unit, hexId, route = null, scoreContext = null) {
    if (unit.side !== "axis") return 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    if (combat < 3 && movement < 6) return 0;

    const currentOvermass = scoreContext?.axisCurrentOvermass ?? axisLocalAttackOvermassScore(unit, unit.hexId);
    const candidateOvermass = axisLocalAttackOvermassScore(unit, hexId);
    const releasedOvermass = Math.max(0, currentOvermass - candidateOvermass);
    const currentObjectiveDistance = nearestDistance(unit.hexId, axisObjectiveHexes());
    const candidateObjectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    const progress = currentObjectiveDistance - candidateObjectiveDistance;
    if (releasedOvermass <= 0 && progress <= 0) return 0;

    const mates = liveUnits().filter((ally) => ally.side === "axis" && ally.id !== unit.id && !ally.disrupted);
    const exactLinks = mates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
    const adjacentCrowd = mates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
    const objectiveBand = candidateObjectiveDistance >= 3 && candidateObjectiveDistance <= 9
      ? Math.max(0, 10 - candidateObjectiveDistance) * 9
      : 0;
    const allowance = Math.max(movementAllowance(unit), movement);
    const spent = route ? Math.max(0, allowance - Number(route.remaining || 0)) : 0;
    const efficientMove = !route || spent <= Math.max(4, allowance * 0.74);
    const lineShape = Math.min(3, exactLinks) * 42 - adjacentCrowd * 32;
    const mobileFit = movement >= 8 ? 1.18 : movement >= 6 ? 1 : 0.72;
    const score = releasedOvermass * 0.16
      + Math.max(0, progress) * (combat >= 4 ? 54 : 34)
      + objectiveBand
      + lineShape
      + (isAxisAssaultUnit(unit) ? 36 : 0);
    return app.aiHeuristics.clampScore(score * mobileFit * (efficientMove ? 1 : 0.58), -120, 520);
  }

  function axisMobileGroupSupportScore(unit, hexId) {
    let score = 0;
    let nearestSupport = Infinity;
    for (const ally of liveUnits().filter((candidate) => candidate.side === "axis" && candidate.id !== unit.id && !candidate.disrupted)) {
      const distance = hexDistance(hexId, ally.hexId);
      if (isAxisAssaultUnit(ally)) {
        nearestSupport = Math.min(nearestSupport, distance);
        if (distance === 2) score += 6;
        else if (distance === 3) score += 4;
        else if (distance === 1) score += 1.5;
        else if (distance === 4) score += 1.5;
      } else if (distance <= 2) {
        score += Number(ally.combat || 0) * 0.45;
      }
    }
    if (nearestSupport > 3 && nearestDistance(hexId, axisObjectiveHexes()) > 1) score -= 8;
    return score;
  }

  function axisObjectiveAttackPositionScore(unit, hexId) {
    if (!isAxisAssaultUnit(unit)) return 0;
    const urgency = app.state.turn >= 4 ? 1.75 : app.state.turn >= 3 ? 1.35 : app.state.turn === 2 ? 0.95 : 0.55;
    let score = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const distanceToObjective = hexDistance(hexId, objectiveHexId);
      if (distanceToObjective > 3) continue;
      const occupant = liveUnitAt(objectiveHexId);
      const adjacentAxisAssault = neighborsOf(objectiveHexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && isAxisAssaultUnit(ally) && !ally.disrupted)
        .length;
      if (occupant?.side === "allied") {
        if (distanceToObjective === 1) {
          score += (46 + adjacentAxisAssault * 26 + strategicUnitValueForSide("axis", occupant) * 0.18) * urgency;
        } else if (distanceToObjective === 2) {
          score += 14 * urgency;
        }
      } else if (occupant?.side === "axis" && occupant.id !== unit.id) {
        if (distanceToObjective === 1) {
          const counterThreat = neighborsOf(objectiveHexId)
            .map(liveUnitAt)
            .filter((enemy) => enemy && enemy.side === "allied" && !enemy.disrupted)
            .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
          score += (36 + Math.min(30, counterThreat * 3)) * urgency;
        } else if (distanceToObjective === 2) {
          score += 14 * urgency;
        }
      } else if (!occupant && distanceToObjective === 1 && app.state.turn >= 3) {
        const nearbyAllied = neighborsOf(objectiveHexId).some((neighborId) => {
          const enemy = liveUnitAt(neighborId);
          return enemy?.side === "allied" && !enemy.disrupted;
        });
        if (nearbyAllied) score += 20 * urgency;
      }
    }
    return score;
  }

  function axisFinalAssaultMassScore(unit, hexId) {
    if (!isAxisAssaultUnit(unit) || app.state.turn < 3) return 0;
    let score = 0;
    const urgency = app.state.turn >= 4 ? 1.65 : 0.85;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const occupant = liveUnitAt(objectiveHexId);
      if (occupant?.side !== "allied") continue;
      const distanceToObjective = hexDistance(hexId, objectiveHexId);
      if (distanceToObjective > 2) continue;
      const adjacentAxisAssault = neighborsOf(objectiveHexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "axis" && ally.id !== unit.id && isAxisAssaultUnit(ally) && !ally.disrupted)
        .length;
      const need = Math.max(0, 2 - adjacentAxisAssault);
      if (distanceToObjective === 1) {
        score += (82 + need * 34 + Number(unit.combat || 0) * 5) * urgency;
      }
    }
    return score;
  }

  function axisFinalApproachTempoScore(unit, hexId) {
    if (!isAxisAssaultUnit(unit)) return 0;
    const objectiveHeld = axisObjectiveHexes().some((objectiveHexId) => liveUnitAt(objectiveHexId)?.side === "axis");
    return app.aiHeuristics.finalApproachTempoScore({
      turn: app.state.turn,
      currentDistance: nearestDistance(unit.hexId, axisObjectiveHexes()),
      candidateDistance: nearestDistance(hexId, axisObjectiveHexes()),
      objectiveHeld,
    });
  }

  function axisSpearheadPressureScore(unit, hexId) {
    const targets = axisUnitTargetHexes(unit);
    const targetDistance = nearestDistance(hexId, targets);
    let score = Math.max(0, 8 - targetDistance) * 4.8;
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      if (enemyDistance > 2) continue;
      score += strategicUnitValueForSide("axis", enemy) * (enemyDistance === 1 ? 0.18 : 0.08);
    }
    return score;
  }

  function axisZocScreenScore(unit, hexId) {
    const westExit = app.scenario.objectives.alliedWestExitEdge;
    let score = Math.max(0, 3 - nearestDistance(hexId, westExit)) * 3 + axisExitCoverageScore(hexId, unit.id) * 0.42;
    for (const ally of liveUnits().filter((candidate) => candidate.side === "axis" && candidate.id !== unit.id && !candidate.eliminated)) {
      const distance = hexDistance(hexId, ally.hexId);
      if (distance === 2) score += isAxisAssaultUnit(ally) ? 1.5 : 7.5;
      else if (distance === 3) score += isAxisAssaultUnit(ally) ? 0.5 : 3.2;
      else if (distance === 1 && !isAxisAssaultUnit(ally)) score += 1.2;
    }
    for (const enemy of liveUnits().filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      if (nearestDistance(enemy.hexId, westExit) > 8) continue;
      const distance = hexDistance(hexId, enemy.hexId);
      if (distance === 2) score += 8;
      else if (distance === 3) score += 4;
      else if (distance === 1) score += 2.5;
    }
    return score;
  }

  function axisDynamicScreenScore(unit, hexId) {
    if (unit.side !== "axis" || isAxisAssaultUnit(unit)) return 0;
    const westExit = app.scenario.objectives.alliedWestExitEdge;
    const units = liveUnits();
    const alliedUnits = units.filter((candidate) => candidate.side === "allied" && !candidate.disrupted);
    if (!alliedUnits.length) return 0;

    const combat = Number(unit.combat || 0);
    const maxExitThreat = Math.max(0, ...westExit.map((exitHexId) => alliedExitThreat(exitHexId)));
    const exitDistance = nearestDistance(hexId, westExit);
    let score = 0;

    if (maxExitThreat < 12 && exitDistance <= 1) score -= 28 + combat * 2.4;
    else if (exitDistance === 1) score += 16;
    else if (exitDistance === 2) score += 18;
    else if (exitDistance === 3) score += 10;
    else if (exitDistance === 4) score += 4;

    for (const ally of units.filter((candidate) => candidate.side === "axis" && candidate.id !== unit.id && !candidate.disrupted)) {
      const distance = hexDistance(hexId, ally.hexId);
      if (distance === 2) score += isAxisAssaultUnit(ally) ? 7 : 19 + Math.min(5, Number(ally.combat || 0));
      else if (distance === 3) score += isAxisAssaultUnit(ally) ? 5 : 8;
      else if (distance === 1 && !isAxisAssaultUnit(ally)) score -= 5;
    }

    const assaultUnits = units.filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (assaultUnits.length) {
      const nearestAssault = Math.min(...assaultUnits.map((assault) => hexDistance(hexId, assault.hexId)));
      if (nearestAssault === 2) score += 16;
      else if (nearestAssault === 3) score += 12;
      else if (nearestAssault === 4) score += 6;
      else if (nearestAssault <= 1) score -= 6;
    }

    for (const enemy of alliedUnits) {
      const enemyExitDistance = nearestDistance(enemy.hexId, westExit);
      const enemyObjectiveDistance = nearestDistance(enemy.hexId, axisObjectiveHexes());
      if (enemyExitDistance > 9 && enemyObjectiveDistance > 7) continue;
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      if (enemyDistance === 2) score += 16 + Math.min(6, Number(enemy.combat || 0));
      else if (enemyDistance === 3) score += 7;
      else if (enemyDistance === 1) score += combat >= 4 ? 4 : -5;
      if (enemyDistance + exitDistance <= enemyExitDistance + 2) score += Math.max(0, 7 - enemyDistance) * 4.5;
    }

    const objectiveGain = nearestDistance(unit.hexId, axisObjectiveHexes()) - nearestDistance(hexId, axisObjectiveHexes());
    if (objectiveGain > 0 && exitDistance > 1) score += Math.min(18, objectiveGain * 4.5);
    return Math.min(250, Math.max(-80, score));
  }

  function axisForwardZocLineScore(unit, hexId) {
    if (unit.side !== "axis") return 0;
    const units = liveUnits();
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const assault = isAxisAssaultUnit(unit);
    const currentObjectiveDistance = nearestDistance(unit.hexId, axisObjectiveHexes());
    const candidateObjectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    if (candidateObjectiveDistance > 12 && currentObjectiveDistance > 12) return 0;

    const axisMates = units.filter((candidate) => (
      candidate.side === "axis"
      && candidate.id !== unit.id
      && !candidate.disrupted
      && nearestDistance(candidate.hexId, axisObjectiveHexes()) <= 12
    ));
    const exactLineMates = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
    const looseLineMates = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 3).length;
    const adjacentCrowd = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
    const closeCrowd = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) <= 2).length;
    const denseCrowd = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) <= 3).length;
    const progress = currentObjectiveDistance - candidateObjectiveDistance;
    const weights = app.aiHeuristics.AI_HEURISTIC_WEIGHTS.axisLine;
    let score = app.aiHeuristics.lineSpacingScore({
      exactLinks: exactLineMates,
      looseLinks: looseLineMates,
      adjacentCrowd,
      closeCrowd,
      denseCrowd,
      exactWeight: assault ? weights.exactAssault : weights.exactSupport,
      looseWeight: assault ? weights.looseAssault : weights.looseSupport,
      adjacentPenalty: assault ? weights.adjacentAssaultPenalty : weights.adjacentSupportPenalty,
      closeLimit: 3,
      closePenalty: assault ? weights.closeAssaultPenalty : weights.closeSupportPenalty,
      denseLimit: 5,
      densePenalty: weights.densePenalty,
    });
    if (progress > 0) score += progress * (assault ? 8 : combat >= 3 ? 5.2 : 1.6);
    if (progress < -1) score += progress * (assault ? 10 : 15);
    if (!exactLineMates && candidateObjectiveDistance <= 9) score -= assault ? 56 : combat >= 3 ? 110 : 54;
    if (exactLineMates && adjacentCrowd === 0) score += assault ? 26 : 46;

    const westExit = app.scenario.objectives.alliedWestExitEdge;
    const uncoveredExitThreat = westExit.reduce((sum, exitHexId) => (
      isAxisExitCoveredByOther(exitHexId, unit.id) ? sum : sum + alliedExitThreat(exitHexId)
    ), 0);
    if (combat >= 3 && movement >= 6 && nearestDistance(hexId, westExit) <= 2 && uncoveredExitThreat < 48) {
      score -= 120 + combat * 12;
    }

    for (const enemy of units.filter((candidate) => candidate.side === "allied" && !candidate.disrupted)) {
      const enemyDistance = hexDistance(hexId, enemy.hexId);
      const enemyObjectiveDistance = nearestDistance(enemy.hexId, axisObjectiveHexes());
      const enemyExitDistance = nearestDistance(enemy.hexId, westExit);
      if (enemyObjectiveDistance > 11 && enemyExitDistance > 10) continue;
      if (enemyDistance === 2) score += 24 + combat * 1.6;
      else if (enemyDistance === 3) score += 12;
      else if (enemyDistance === 1) score += combat >= 4 ? 3 : -18;
      if (enemyDistance <= 5 && candidateObjectiveDistance < enemyObjectiveDistance) {
        score += Math.max(0, 6 - enemyDistance) * (assault ? 5.2 : 3.6);
      }
    }

    return app.aiHeuristics.clampScore(score, -180, 360);
  }

  function axisForwardScreenTempoScore(unit, hexId) {
    if (unit.side !== "axis" || isAxisAssaultUnit(unit)) return 0;
    const units = liveUnits();
    const combat = Number(unit.combat || 0);
    const currentObjectiveDistance = nearestDistance(unit.hexId, axisObjectiveHexes());
    const candidateObjectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    if (candidateObjectiveDistance > 13 && currentObjectiveDistance > 13) return 0;

    const assaultUnits = units.filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    const nearestAssault = assaultUnits.length
      ? Math.min(...assaultUnits.map((assault) => hexDistance(hexId, assault.hexId)))
      : Infinity;
    const progress = currentObjectiveDistance - candidateObjectiveDistance;
    const axisMates = units.filter((ally) => ally.side === "axis" && ally.id !== unit.id && !ally.disrupted);
    const exactLinks = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
    const looseLinks = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 3).length;
    const adjacentCrowd = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
    const closeCrowd = axisMates.filter((ally) => hexDistance(hexId, ally.hexId) <= 2).length;
    const westExit = app.scenario.objectives.alliedWestExitEdge;
    const uncoveredExitThreat = westExit.reduce((sum, exitHexId) => (
      isAxisExitCoveredByOther(exitHexId, unit.id) ? sum : sum + alliedExitThreat(exitHexId)
    ), 0);

    let score = progress * (combat >= 3 ? 26 : combat >= 2 ? 18 : 10);
    if (progress < 0) score += progress * (combat >= 3 ? 22 : combat >= 2 ? 16 : 10);
    if (progress > 0 && uncoveredExitThreat < 48 && Number(unit.movement || 0) >= 6) score += progress * (combat >= 3 ? 12 : 7);
    if (candidateObjectiveDistance >= 4 && candidateObjectiveDistance <= 10) {
      score += (11 - candidateObjectiveDistance) * (combat >= 3 ? 7.2 : combat >= 2 ? 4.8 : 2.8);
    }
    if (candidateObjectiveDistance <= 3 && app.state.turn <= 2) score -= (4 - candidateObjectiveDistance) * (combat >= 3 ? 18 : 10);

    if (nearestAssault === 2) score += 54 + combat * 3;
    else if (nearestAssault === 3) score += 36 + combat * 2;
    else if (nearestAssault === 4) score += 16;
    else if (nearestAssault <= 1) score -= 22;
    else if (nearestAssault > 5 && candidateObjectiveDistance <= 10) score -= 34;

    score += Math.min(3, exactLinks) * 28 + Math.min(2, looseLinks) * 8;
    score -= adjacentCrowd * 24 + Math.max(0, closeCrowd - 3) * 42;
    if (!exactLinks && candidateObjectiveDistance <= 10) score -= combat >= 3 ? 52 : 26;
    if (nearestDistance(hexId, westExit) <= 2 && uncoveredExitThreat < 48) score -= 84 + combat * 9;

    return app.aiHeuristics.clampScore(score, -220, 320);
  }

  function axisExitCoverageScore(hexId, movingUnitId = null) {
    let score = 0;
    for (const exitHexId of app.scenario.objectives.alliedWestExitEdge) {
      const threat = alliedExitThreat(exitHexId);
      if (!threat) continue;
      const alreadyCovered = isAxisExitCoveredByOther(exitHexId, movingUnitId);
      const distance = hexDistance(hexId, exitHexId);
      const coverageMultiplier = alreadyCovered ? 0.08 : 1;
      if (distance === 0) score += threat * 4.8 * coverageMultiplier;
      else if (distance === 1) score += threat * 6.4 * coverageMultiplier;
      else if (distance === 2) score += threat * 0.45 * coverageMultiplier;
    }
    return score;
  }

  function isAxisExitCoveredByOther(exitHexId, movingUnitId = null) {
    return liveUnits().some((unit) => {
      if (unit.id === movingUnitId || unit.side !== "axis" || unit.disrupted) return false;
      return hexDistance(unit.hexId, exitHexId) <= 2;
    });
  }

  function axisRearGuardScore(unit, hexId) {
    const westExit = app.scenario.objectives.alliedWestExitEdge;
    const threat = liveUnits().some((enemy) => enemy.side === "allied" && !enemy.disrupted && nearestDistance(enemy.hexId, westExit) <= 4);
    if (!threat) return 0;
    const combat = Number(unit.combat || 0);
    const guardBias = Math.max(0, 5 - combat) * 1;
    const mobilityPenalty = Number(unit.movement || 0) >= 9 ? 0.45 : 1.55;
    const distanceToExit = nearestDistance(hexId, westExit);
    let score = Math.max(0, 4 - distanceToExit) * (guardBias + mobilityPenalty) + (westExit.includes(hexId) ? 5 + guardBias * 1.2 : 0);
    const uncoveredExitThreat = westExit.reduce((sum, exitHexId) => (
      isAxisExitCoveredByOther(exitHexId, unit.id) ? sum : sum + alliedExitThreat(exitHexId)
    ), 0);
    if (combat >= 3 && Number(unit.movement || 0) >= 6 && nearestDistance(hexId, westExit) <= 2 && uncoveredExitThreat < 32) {
      score -= 76 + combat * 8;
    }
    for (const exitHexId of westExit) {
      const exitThreat = alliedExitThreat(exitHexId);
      if (!exitThreat) continue;
      const distance = hexDistance(hexId, exitHexId);
      const guardSuitability = Number(unit.movement || 0) >= 9 && combat >= 4 ? 0.55 : 1;
      if (distance === 0) score += exitThreat * 4.2 * guardSuitability;
      else if (distance === 1) score += exitThreat * 0.55 * guardSuitability;
    }
    if (combat >= 3 && Number(unit.movement || 0) >= 6 && uncoveredExitThreat < 48) score *= 0.18;
    return score;
  }

  function alliedExitThreat(exitHexId) {
    return liveUnits()
      .filter((unit) => unit.side === "allied" && !unit.disrupted)
      .reduce((score, unit) => {
        const distance = hexDistance(unit.hexId, exitHexId);
        const allowance = Math.max(movementAllowance(unit), Number(unit.movement || 0));
        if (distance < allowance) return score + 18 + (allowance - distance) * 4 + Number(unit.combat || 0);
        if (distance <= allowance + 1) return score + 5;
        return score;
      }, 0);
  }

  function alliedDefenseScore(hexId) {
    let score = 0;
    const hex = hexById(hexId);
    if (app.scenario.objectives.alamHalfaRidge.includes(hexId)) score += 45;
    if (app.scenario.objectives.coastalRoadEast.includes(hexId)) score += 18;
    if (hex?.britishPosition) score += 18;
    return score;
  }

  function alliedScreenScore(hexId) {
    const distanceToAxisObjective = nearestDistance(hexId, axisObjectiveHexes());
    const distanceToWestExit = nearestDistance(hexId, app.scenario.objectives.alliedWestExitEdge);
    const forwardWall = distanceToAxisObjective >= 4 && distanceToAxisObjective <= 9
      ? 46 + Math.max(0, 4 - Math.abs(distanceToAxisObjective - 6)) * 9
      : Math.max(0, 5 - distanceToAxisObjective) * 1.2;
    const objectiveHugPenalty = distanceToAxisObjective <= 2 ? (3 - distanceToAxisObjective) * 24 : 0;
    return forwardWall + Math.max(0, 4 - distanceToWestExit) * 0.5 - objectiveHugPenalty;
  }

  function alliedForwardDefenseScore(unit, hexId) {
    let score = 0;
    const objectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    for (const axisUnit of liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted)) {
      const axisTargets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, axisTargets);
      const axisDistance = hexDistance(hexId, axisUnit.hexId);
      const hexToObjective = nearestDistance(hexId, axisTargets);
      const onApproachLane = axisDistance + hexToObjective <= axisToObjective + 2;
      if (!onApproachLane || axisDistance > 6) continue;
      if (axisDistance === 2) score += 12;
      else if (axisDistance === 3) score += 10;
      else if (axisDistance === 4) score += 6;
      else if (axisDistance === 5) score += 3;
      else if (axisDistance === 1) score -= Number(axisUnit.combat || 0) >= 6 ? 9 : 4;
      score += Math.max(0, 8 - hexToObjective) * 1.4;
    }
    if (objectiveDistance <= 8) score += Math.max(0, 9 - objectiveDistance) * 0.8;
    return score;
  }

  function alliedZocBarrierScore(unit, hexId) {
    let score = 0;
    const zocHexes = [hexId, ...neighborsOf(hexId)];
    for (const axisUnit of liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted)) {
      const axisTargets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, axisTargets);
      let laneCoverage = 0;
      for (const zocHexId of zocHexes) {
        const axisDistance = hexDistance(zocHexId, axisUnit.hexId);
        if (axisDistance < 2 || axisDistance > 7) continue;
        const objectiveDistance = nearestDistance(zocHexId, axisTargets);
        if (objectiveDistance > 8) continue;
        const onApproachLane = axisDistance + objectiveDistance <= axisToObjective + 3;
        if (!onApproachLane) continue;
        laneCoverage += (8 - axisDistance) * 1.7 + Math.max(0, 8 - objectiveDistance) * 0.85;
        if (objectiveDistance >= 2 && objectiveDistance <= 5) laneCoverage += 5;
      }
      score += Math.min(32, laneCoverage);
    }
    const objectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    if (objectiveDistance >= 2 && objectiveDistance <= 7) score += (8 - objectiveDistance) * 1.6;
    if (objectiveDistance <= 1) score -= 8;
    return score;
  }

  function alliedInterlockingZocScore(unit, hexId) {
    const objectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    if (objectiveDistance > 9) return 0;
    let score = 0;
    for (const ally of liveUnits().filter((candidate) => candidate.side === "allied" && candidate.id !== unit.id && !candidate.disrupted)) {
      const allyObjectiveDistance = nearestDistance(ally.hexId, axisObjectiveHexes());
      if (allyObjectiveDistance > 10) continue;
      const distance = hexDistance(hexId, ally.hexId);
      if (distance === 2) score += 11 + Math.min(5, Number(ally.combat || 0));
      else if (distance === 3) score += 4;
      else if (distance === 1) score += 1;
    }
    for (const axisUnit of liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted)) {
      const axisTargets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, axisTargets);
      const axisDistance = hexDistance(hexId, axisUnit.hexId);
      const hexToObjective = nearestDistance(hexId, axisTargets);
      if (axisDistance >= 2 && axisDistance <= 6 && axisDistance + hexToObjective <= axisToObjective + 3) {
        score += Math.max(0, 7 - hexToObjective) * 1.7;
      }
    }
    return Math.min(70, score);
  }

  function alliedRoadApproachScreenScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    const roadHexes = app.scenario.objectives.coastalRoadEast;
    const zocHexes = [hexId, ...neighborsOf(hexId)];
    const lineLinks = liveUnits().filter((ally) => (
      ally.side === "allied"
      && ally.id !== unit.id
      && !ally.disrupted
      && hexDistance(hexId, ally.hexId) === 2
      && nearestDistance(ally.hexId, roadHexes) <= 8
    )).length;
    const scores = [];

    for (const roadHexId of roadHexes) {
      const hexToRoad = hexDistance(hexId, roadHexId);
      if (hexToRoad < 3 || hexToRoad > 7) continue;
      for (const axisUnit of axisAssaultUnits) {
        const axisToRoad = hexDistance(axisUnit.hexId, roadHexId);
        const axisToHex = hexDistance(axisUnit.hexId, hexId);
        const zocCutsLane = zocHexes.some((zocHexId) => {
          const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
          const zocToRoad = hexDistance(zocHexId, roadHexId);
          return zocToAxis >= 1
            && zocToAxis <= 6
            && zocToRoad < axisToRoad
            && zocToAxis + zocToRoad <= axisToRoad + 2;
        });
        scores.push(app.aiHeuristics.roadApproachScreenScore({
          turn: app.state.turn,
          hexToRoad,
          axisToRoad,
          axisToHex,
          zocCutsLane,
          lineLinks,
          combat: Number(unit.combat || 0),
          movement: Number(unit.movement || 0),
        }));
      }
    }

    return scores
      .sort((a, b) => b - a)
      .slice(0, 2)
      .reduce((sum, score) => sum + score, 0);
  }

  function alliedRoadblockScore(unit, hexId) {
    const roadHexes = app.scenario.objectives.coastalRoadEast;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;
    const closestRoadThreat = Math.min(...axisAssaultUnits.map((axisUnit) => nearestDistance(axisUnit.hexId, roadHexes)));
    if (closestRoadThreat > 8 && app.state.turn <= 2) return 0;

    let score = 0;
    for (const objectiveHexId of roadHexes) {
      const objectiveThreat = Math.min(...axisAssaultUnits.map((axisUnit) => hexDistance(axisUnit.hexId, objectiveHexId)));
      if (objectiveThreat > closestRoadThreat + 2 || objectiveThreat > 8) continue;

      const distanceToObjective = hexDistance(hexId, objectiveHexId);
      if (distanceToObjective > 2) continue;

      const gatePressure = axisAssaultUnits.reduce((sum, axisUnit) => {
        const axisToObjective = hexDistance(axisUnit.hexId, objectiveHexId);
        const axisToHex = hexDistance(axisUnit.hexId, hexId);
        if (axisToHex > 6) return sum;
        const onApproachLane = axisToHex + distanceToObjective <= axisToObjective + 1;
        if (!onApproachLane) return sum;
        return sum + Math.max(0, 8 - axisToHex) + Math.max(0, 7 - axisToObjective) * 0.7;
      }, 0);
      if (!gatePressure && distanceToObjective > 0) continue;

      const currentGateCount = roadGateCount(objectiveHexId, unit.id);
      const need = Math.max(0, 4 - currentGateCount);
      const urgency = app.state.turn <= 2 ? 1.35 : app.state.turn === 3 ? 1.15 : 1;
      const combat = Number(unit.combat || 0);
      const occupant = liveUnitAt(objectiveHexId);
      const defenderSuitability = combat >= 4 ? 1.05 : combat >= 3 ? 0.8 : combat >= 2 ? 0.45 : 0.16;
      const blockerSuitability = combat >= 4 ? 1.12 : combat >= 2 ? 0.86 : 0.24;

      if (distanceToObjective === 0) {
        if (occupant?.side === "allied" && unit.hexId === objectiveHexId) {
          score += (42 + need * 12 + combat * 4) * urgency * defenderSuitability;
        } else if (!occupant && objectiveThreat <= 5) {
          score += (38 + combat * 3) * urgency * defenderSuitability;
        }
      } else if (distanceToObjective === 1) {
        score += (72 + need * 24 + gatePressure * 11 + combat * 5) * urgency * blockerSuitability;
        if (isEnemyZoc(hexId, unit.side, unit.id)) score += combat >= 3 ? 16 : combat >= 2 ? 4 : -8;
        if (combat <= 1 && hasStrongerRoadGateReserve(unit, hexId)) score -= 260 * urgency;
      } else if (distanceToObjective === 2 && Number(unit.movement || 0) >= 7) {
        score += (16 + gatePressure * 3 + need * 5) * urgency * (combat >= 2 ? 1 : 0.55);
      }
    }
    return Math.min(340, score);
  }

  function alliedObjectiveGateLatchScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;
    let score = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const hexToObjective = hexDistance(hexId, objectiveHexId);
      if (hexToObjective > 1) continue;
      const nearestAxis = axisAssaultUnits
        .map((axisUnit) => ({
          axisToObjective: hexDistance(axisUnit.hexId, objectiveHexId),
          axisToHex: hexDistance(axisUnit.hexId, hexId),
        }))
        .sort((a, b) => a.axisToObjective - b.axisToObjective || a.axisToHex - b.axisToHex)[0];
      if (!nearestAxis) continue;
      score += app.aiHeuristics.objectiveGateLatchScore({
        turn: app.state.turn,
        hexToObjective,
        axisToObjective: nearestAxis.axisToObjective,
        axisToHex: nearestAxis.axisToHex,
        currentGateCount: roadGateCount(objectiveHexId, unit.id),
        combat: Number(unit.combat || 0),
        movement: Number(unit.movement || 0),
        inEnemyZoc: isEnemyZoc(hexId, unit.side, unit.id),
        occupiedByAllied: liveUnitAt(objectiveHexId)?.side === "allied",
      });
    }
    return Math.min(520, score);
  }

  function alliedFinalGateScreenScore(unit, hexId) {
    if (unit.side !== "allied" || app.state.turn < 2) return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    const zocHexes = [hexId, ...neighborsOf(hexId)];
    let score = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const axisThreat = axisAssaultUnits
        .map((axisUnit) => ({
          axisUnit,
          axisToObjective: hexDistance(axisUnit.hexId, objectiveHexId),
          axisToHex: hexDistance(axisUnit.hexId, hexId),
        }))
        .sort((a, b) => a.axisToObjective - b.axisToObjective || a.axisToHex - b.axisToHex)[0];
      if (!axisThreat || axisThreat.axisToObjective > 6) continue;

      const hexToObjective = hexDistance(hexId, objectiveHexId);
      if (hexToObjective > 2) continue;
      const lineLinks = liveUnits().filter((ally) => (
        ally.side === "allied"
        && ally.id !== unit.id
        && !ally.disrupted
        && hexDistance(hexId, ally.hexId) === 2
        && hexDistance(ally.hexId, objectiveHexId) <= 3
      )).length;
      const zocCutsLane = zocHexes.some((zocHexId) => {
        const zocToAxis = hexDistance(zocHexId, axisThreat.axisUnit.hexId);
        const zocToObjective = hexDistance(zocHexId, objectiveHexId);
        return zocToAxis >= 1
          && zocToAxis <= 5
          && zocToObjective < axisThreat.axisToObjective
          && zocToAxis + zocToObjective <= axisThreat.axisToObjective + 2;
      });
      score += app.aiHeuristics.finalGateScreenScore({
        turn: app.state.turn,
        hexToObjective,
        axisToObjective: axisThreat.axisToObjective,
        axisToHex: axisThreat.axisToHex,
        gateCount: roadGateCount(objectiveHexId, unit.id),
        lineLinks,
        occupiedByAllied: liveUnitAt(objectiveHexId)?.side === "allied",
        zocCutsLane,
        combat: Number(unit.combat || 0),
        movement: Number(unit.movement || 0),
      });
    }

    return Math.min(760, score);
  }

  function alliedSupportedLineScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    let score = 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    for (const objectiveHexId of axisObjectiveHexes()) {
      const nearestThreat = Math.min(...axisAssaultUnits.map((axisUnit) => hexDistance(axisUnit.hexId, objectiveHexId)));
      if (nearestThreat > 7) continue;
      const hexToObjective = hexDistance(hexId, objectiveHexId);
      if (hexToObjective > 2) continue;
      const adjacentAllied = neighborsOf(hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "allied" && ally.id !== unit.id && !ally.disrupted);
      const interlockAllied = liveUnits().filter((ally) => (
        ally.side === "allied"
        && ally.id !== unit.id
        && !ally.disrupted
        && hexDistance(hexId, ally.hexId) === 2
        && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 8
      ));
      const supportStrength = adjacentAllied.reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
      const lineShape = adjacentAllied.length * 16 + interlockAllied.length * 22 + Math.min(18, supportStrength * 2);
      const pressure = Math.max(0, 8 - nearestThreat);
      const screenSuitability = combat <= 2 ? 0.82 : combat >= 4 ? 1.12 : 1;
      const mobileReserve = movement >= 7 && hexToObjective === 1 ? 1.12 : 1;
      if (hexToObjective === 1) {
        score += (86 + pressure * 14 + lineShape) * screenSuitability * mobileReserve;
      } else if (hexToObjective === 2 && movement >= 7) {
        score += (36 + pressure * 8 + lineShape * 0.55) * (combat >= 3 ? 1.05 : 0.72);
      } else if (hexToObjective === 0 && adjacentAllied.length >= 2) {
        score += (28 + lineShape * 0.38) * (combat >= 3 ? 0.82 : 1);
      }
    }
    return Math.min(300, score);
  }

  function alliedApproachInterdictionScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    let score = 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const zocHexes = [hexId, ...neighborsOf(hexId)];
    for (const axisUnit of axisAssaultUnits) {
      const targets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, targets);
      if (axisToObjective > 9) continue;
      const candidateToObjective = nearestDistance(hexId, targets);
      if (candidateToObjective < 2 || candidateToObjective > 5) continue;
      const candidateToAxis = hexDistance(hexId, axisUnit.hexId);
      if (candidateToAxis < 2 || candidateToAxis > 7) continue;
      if (candidateToAxis + candidateToObjective > axisToObjective + 3) continue;

      const zocCutsLane = zocHexes.some((zocHexId) => {
        const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
        if (zocToAxis < 1 || zocToAxis > 6) return false;
        const zocToObjective = nearestDistance(zocHexId, targets);
        return zocToObjective < axisToObjective && zocToAxis + zocToObjective <= axisToObjective + 2;
      });
      if (!zocCutsLane) continue;

      const lineMates = liveUnits().filter((ally) => (
        ally.side === "allied"
        && ally.id !== unit.id
        && !ally.disrupted
        && hexDistance(hexId, ally.hexId) >= 2
        && hexDistance(hexId, ally.hexId) <= 3
        && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 8
      )).length;
      if (lineMates === 0 && combat < 4) continue;
      if (lineMates === 0 && candidateToObjective > 3) continue;
      const depth = candidateToObjective === 3 ? 1.22 : candidateToObjective === 2 || candidateToObjective === 4 ? 1 : 0.72;
      const timing = app.state.turn <= 2 ? 1.12 : app.state.turn === 3 ? 1.08 : 0.86;
      const suitability = combat >= 4 ? 1.18 : combat >= 2 ? 1 : 0.62;
      const pressure = Math.max(0, 7 - candidateToAxis) * 10 + Math.max(0, 6 - candidateToObjective) * 8;
      score += (38 + pressure * 0.55 + Math.min(28, lineMates * 12)) * depth * timing * suitability;
      if (movement >= 7) score += 10;
      if (candidateToAxis === 2 && combat >= 3) score += 12;
    }
    return Math.min(210, score);
  }

  function alliedForwardScreenLineScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const units = liveUnits();
    const axisAssaultUnits = units.filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const zocHexes = [hexId, ...neighborsOf(hexId)];
    let score = 0;
    const lineMates = units.filter((ally) => (
      ally.side === "allied"
      && ally.id !== unit.id
      && !ally.disrupted
      && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 9
    ));
    const interlocks = lineMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
    const looseLinks = lineMates.filter((ally) => hexDistance(hexId, ally.hexId) === 3).length;
    const crowding = lineMates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
    const lineShape = interlocks * 48 + looseLinks * 4 - crowding * 24;

    if (app.state.turn <= 2 && nearestDistance(hexId, axisObjectiveHexes()) <= 1) score -= 24;

    for (const axisUnit of axisAssaultUnits) {
      const targets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, targets);
      const candidateToObjective = nearestDistance(hexId, targets);
      const candidateToAxis = hexDistance(hexId, axisUnit.hexId);
      if (candidateToObjective < 2 || candidateToObjective > 7) continue;
      if (candidateToAxis < 2 || candidateToAxis > 8) continue;
      if (candidateToAxis + candidateToObjective > axisToObjective + 4) continue;

      const cutsLane = zocHexes.some((zocHexId) => {
        const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
        const zocToObjective = nearestDistance(zocHexId, targets);
        return zocToObjective < axisToObjective && zocToAxis + zocToObjective <= axisToObjective + 2;
      });

      const depth = candidateToObjective === 4 ? 1.25
        : candidateToObjective === 5 ? 1.1
          : candidateToObjective === 3 ? 1
            : candidateToObjective === 6 ? 0.84
              : 0.64;
      const suitability = combat >= 4 ? 1.16 : combat >= 2 ? 1 : 0.62;
      const pressure = Math.max(0, 8 - candidateToAxis) * 6 + Math.max(0, 7 - candidateToObjective) * 4;
      score += ((cutsLane ? 72 : 32) + pressure + Math.min(96, lineShape)) * depth * suitability;
      if (movement >= 7 && candidateToObjective >= 3) score += 12;
      if (interlocks >= 2) score += 54;
    }

    return Math.min(460, Math.max(-100, score));
  }

  function alliedForwardZocWallScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const units = liveUnits();
    const axisAssaultUnits = units.filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;

    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    const candidateObjectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
    const alliedMates = units.filter((ally) => (
      ally.side === "allied"
      && ally.id !== unit.id
      && !ally.disrupted
      && nearestDistance(ally.hexId, axisObjectiveHexes()) <= 10
    ));
    const exactLinks = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) === 2).length;
    const looseLinks = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) === 3).length;
    const adjacentCrowd = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) === 1).length;
    const closeCrowd = alliedMates.filter((ally) => hexDistance(hexId, ally.hexId) <= 2).length;
    const weights = app.aiHeuristics.AI_HEURISTIC_WEIGHTS.alliedWall;
    let score = app.aiHeuristics.lineSpacingScore({
      exactLinks,
      looseLinks,
      adjacentCrowd,
      closeCrowd,
      exactWeight: weights.exactLink,
      looseWeight: weights.looseLink,
      adjacentPenalty: weights.adjacentPenalty,
      closeLimit: 4,
      closePenalty: weights.closePenalty,
    });
    if (candidateObjectiveDistance >= 4 && candidateObjectiveDistance <= 9) {
      const depthBonus = candidateObjectiveDistance === 6 ? 82
        : candidateObjectiveDistance === 5 ? 72
          : candidateObjectiveDistance === 7 ? 64
            : candidateObjectiveDistance === 4 ? 48
              : candidateObjectiveDistance === 8 ? 36
                : 18;
      score += 132 + depthBonus;
    } else if (candidateObjectiveDistance === 3) {
      score += 18;
    } else if (candidateObjectiveDistance === 2) {
      score -= app.state.turn <= 3 ? 34 : 8;
    } else if (candidateObjectiveDistance <= 1 && app.state.turn <= 3) {
      score -= 170;
    }

    const zocHexes = [hexId, ...neighborsOf(hexId)];
    for (const axisUnit of axisAssaultUnits) {
      const targets = axisUnitTargetHexes(axisUnit);
      const axisToObjective = nearestDistance(axisUnit.hexId, targets);
      if (axisToObjective > 10) continue;
      const candidateToObjective = nearestDistance(hexId, targets);
      const candidateToAxis = hexDistance(hexId, axisUnit.hexId);
      if (candidateToObjective < 2 || candidateToObjective > 7) continue;
      if (candidateToAxis < 2 || candidateToAxis > 8) continue;
      if (candidateToAxis + candidateToObjective > axisToObjective + 4) continue;

      const blocksLane = zocHexes.some((zocHexId) => {
        const zocToAxis = hexDistance(zocHexId, axisUnit.hexId);
        const zocToObjective = nearestDistance(zocHexId, targets);
        return zocToObjective < axisToObjective && zocToAxis + zocToObjective <= axisToObjective + 2;
      });
      const depth = candidateToObjective === 5 ? 1.34
        : candidateToObjective === 6 ? 1.22
          : candidateToObjective === 4 ? 1.16
            : candidateToObjective === 7 ? 0.98
              : candidateToObjective === 3 ? 0.76
                : 0.58;
      const suitability = combat >= 4 ? 1.2 : combat >= 2 ? 1 : 0.58;
      const contactRisk = candidateToAxis === 1 ? -36 : candidateToAxis === 2 ? 18 : 0;
      score += ((blocksLane ? 152 : 64) + Math.max(0, 8 - candidateToAxis) * 10 + exactLinks * 52 + contactRisk) * depth * suitability;
      if (movement >= 7 && candidateToObjective >= 3) score += 24;
    }

    if (!exactLinks && candidateObjectiveDistance >= 4 && candidateObjectiveDistance <= 9) score -= 240;
    if (exactLinks && adjacentCrowd === 0) score += exactLinks >= 2 ? 168 : 104;

    return app.aiHeuristics.clampScore(score, -260, 760);
  }

  function alliedSpearheadCounterattackPositionScore(unit, hexId) {
    if (unit.side !== "allied") return 0;
    const combat = Number(unit.combat || 0);
    const movement = Number(unit.movement || 0);
    let score = 0;
    for (const axisUnit of liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted)) {
      const objectiveDistance = nearestDistance(axisUnit.hexId, axisObjectiveHexes());
      if (objectiveDistance > 4) continue;
      const attackDistance = hexDistance(hexId, axisUnit.hexId);
      if (attackDistance !== 1) continue;
      const existingAttackers = neighborsOf(axisUnit.hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === "allied" && ally.id !== unit.id && !ally.disrupted);
      const supportStrength = existingAttackers.reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
      const groupStrength = combat + supportStrength;
      const supportCount = existingAttackers.length;
      const oddsReady = groupStrength >= Number(axisUnit.combat || 0) * 1.4;
      const weakSolo = combat <= 2 && supportCount === 0;
      if (weakSolo || (supportCount === 0 && combat < 4)) continue;
      const urgency = app.state.turn >= 3 ? 1.25 : 1;
      const mobileFit = movement >= 7 ? 1.12 : 1;
      const nearbyAxisSupport = liveUnits()
        .filter((candidate) => candidate.side === "axis" && candidate.id !== axisUnit.id && !candidate.disrupted && hexDistance(candidate.hexId, axisUnit.hexId) <= 2)
        .reduce((sum, candidate) => sum + Number(candidate.combat || 0), 0);
      const isolatedBonus = nearbyAxisSupport <= 4 ? 42 : nearbyAxisSupport <= 8 ? 18 : 0;
      score += (28 + Math.max(0, 5 - objectiveDistance) * 24 + supportCount * 28 + isolatedBonus + Math.max(0, groupStrength - Number(axisUnit.combat || 0)) * 4.5) * urgency * mobileFit;
      if (oddsReady) score += 24;
    }
    return Math.min(190, Math.max(0, score));
  }

  function alliedIsolatedObjectivePenaltyScore(unit, hexId) {
    if (unit.side !== "allied" || app.state.turn > 3) return 0;
    if (!axisObjectiveHexes().includes(hexId) || Number(unit.combat || 0) < 3) return 0;
    const axisAssaultUnits = liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted);
    if (!axisAssaultUnits.length) return 0;
    const nearestThreat = Math.min(...axisAssaultUnits.map((axisUnit) => hexDistance(axisUnit.hexId, hexId)));
    if (nearestThreat > 5) return 0;
    const support = neighborsOf(hexId)
      .map(liveUnitAt)
      .filter((ally) => ally && ally.side === "allied" && ally.id !== unit.id && !ally.disrupted);
    const supportStrength = support.reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
    const nearbyAxisStrength = liveUnits()
      .filter((enemy) => isAxisAssaultUnit(enemy) && hexDistance(enemy.hexId, hexId) <= 2)
      .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
    if (support.length >= 2 && supportStrength >= 4) return 0;
    return 110 + Math.max(0, nearbyAxisStrength - supportStrength) * 12 + Math.max(0, 6 - nearestThreat) * 18;
  }

  function hasStrongerRoadGateReserve(unit, hexId) {
    return liveUnits().some((candidate) => (
      candidate.side === "allied"
      && candidate.id !== unit.id
      && !candidate.disrupted
      && Number(candidate.combat || 0) >= 3
      && Number(candidate.movement || 0) >= 7
      && hexDistance(candidate.hexId, hexId) <= Math.max(movementAllowance(candidate), Number(candidate.movement || 0)) + 1
    ));
  }

  function roadGateCount(objectiveHexId, movingUnitId = null) {
    return neighborsOf(objectiveHexId)
      .map(liveUnitAt)
      .filter((ally) => ally && ally.side === "allied" && ally.id !== movingUnitId && !ally.disrupted)
      .length;
  }

  function alliedRidgeReserveScore(unit, hexId) {
    const ridgeHexes = app.scenario.objectives.alamHalfaRidge;
    const nearestAxisToRidge = nearestAxisAssaultDistance(ridgeHexes);
    if (nearestAxisToRidge > 7 && app.state.turn < 3) return 0;
    if (isAxisOnCoastalRoad() && nearestDistance(hexId, app.scenario.objectives.coastalRoadEast) > 1 && nearestDistance(unit.hexId, app.scenario.objectives.coastalRoadEast) <= 8) {
      return 0;
    }
    if (isCoastalRoadThreatened() && nearestDistance(unit.hexId, app.scenario.objectives.coastalRoadEast) <= 2 && nearestDistance(hexId, ridgeHexes) > 2) {
      return 0;
    }

    let score = 0;
    const reserveHex = !ridgeHexes.includes(hexId) && ridgeHexes.some((objectiveHexId) => neighborsOf(objectiveHexId).includes(hexId));
    if (reserveHex) {
      for (const objectiveHexId of ridgeHexes) {
        if (!neighborsOf(objectiveHexId).includes(hexId)) continue;
        const defenders = ridgeSupportCount(objectiveHexId, unit.id);
        const occupiedByAllied = liveUnitAt(objectiveHexId)?.side === "allied";
        const occupiedByAxis = liveUnitAt(objectiveHexId)?.side === "axis";
        const threat = ridgeObjectiveThreat(objectiveHexId);
        if (!threat && !occupiedByAxis) continue;
        const need = Math.max(0, 3 - defenders);
        const urgency = occupiedByAxis ? 2.6 : occupiedByAllied ? 1.45 : 1.05;
        score += (28 + need * 34 + Number(unit.combat || 0) * 5) * urgency;
        const nearestAxisHexId = nearestAxisAssaultHex(objectiveHexId);
        if (nearestAxisHexId) {
          const axisDistance = hexDistance(nearestAxisHexId, objectiveHexId);
          const blockerDistance = hexDistance(hexId, nearestAxisHexId);
          if (axisDistance <= 4 && blockerDistance < axisDistance && blockerDistance <= 2) {
            const immediateGate = axisDistance <= 2 && blockerDistance === 1;
            score += (immediateGate ? 190 : 82) + Math.max(0, 5 - axisDistance) * (immediateGate ? 28 : 18);
          } else if (blockerDistance === 2) {
            score += 16;
          }
        }
      }
    } else {
      const ridgeDistance = nearestDistance(hexId, ridgeHexes);
      if (ridgeDistance === 2 && Number(unit.movement || 0) >= 7) score += 22;
      else if (ridgeDistance === 2 && app.state.turn >= 3) score += 10;
    }
    return Math.min(360, score);
  }

  function ridgeObjectiveThreat(objectiveHexId) {
    return liveUnits().some((candidate) => (
      isAxisAssaultUnit(candidate)
      && !candidate.disrupted
      && hexDistance(candidate.hexId, objectiveHexId) <= 5
    ));
  }

  function ridgeSupportCount(objectiveHexId, movingUnitId = null) {
    return neighborsOf(objectiveHexId)
      .map(liveUnitAt)
      .filter((ally) => ally && ally.side === "allied" && ally.id !== movingUnitId && !ally.disrupted)
      .length;
  }

  function nearestAxisAssaultDistance(targets) {
    const distances = liveUnits()
      .filter((unit) => isAxisAssaultUnit(unit) && !unit.disrupted)
      .map((unit) => nearestDistance(unit.hexId, targets));
    return distances.length ? Math.min(...distances) : Infinity;
  }

  function nearestAxisAssaultHex(targetHexId) {
    let best = null;
    for (const unit of liveUnits().filter((candidate) => isAxisAssaultUnit(candidate) && !candidate.disrupted)) {
      const unitDistance = hexDistance(unit.hexId, targetHexId);
      if (!best || unitDistance < best.distance) best = { hexId: unit.hexId, distance: unitDistance };
    }
    return best?.hexId || null;
  }

  function isCoastalRoadThreatened() {
    return app.scenario.objectives.coastalRoadEast.some((objectiveHexId) => {
      if (liveUnitAt(objectiveHexId)?.side === "axis") return true;
      return liveUnits().some((unit) => isAxisAssaultUnit(unit) && !unit.disrupted && hexDistance(unit.hexId, objectiveHexId) <= 3);
    });
  }

  function isAxisOnCoastalRoad() {
    return app.scenario.objectives.coastalRoadEast.some((objectiveHexId) => liveUnitAt(objectiveHexId)?.side === "axis");
  }

  function alliedObjectiveCounterattackScore(unit, hexId) {
    const objectiveScores = [];
    for (const objectiveHexId of axisObjectiveHexes()) {
      let score = 0;
      const occupant = liveUnitAt(objectiveHexId);
      const axisOnObjective = occupant?.side === "axis";
      const axisThreat = axisOnObjective || liveUnits().some((candidate) => (
        isAxisAssaultUnit(candidate)
        && !candidate.disrupted
        && hexDistance(candidate.hexId, objectiveHexId) <= 3
      ));
      if (!axisThreat) continue;
      const distanceToObjective = hexDistance(hexId, objectiveHexId);
      if (axisOnObjective) {
        const adjacentAllied = neighborsOf(objectiveHexId)
          .map(liveUnitAt)
          .filter((ally) => ally && ally.side === "allied" && ally.id !== unit.id && !ally.disrupted)
          .length;
        const earlyEmergency = app.state.turn <= 2 ? 1.35 : 1;
        if (distanceToObjective === 1) score += (132 + adjacentAllied * 28 + Number(unit.combat || 0) * 5) * earlyEmergency;
        else if (distanceToObjective === 2) score += 18 * earlyEmergency;
      } else {
        if (distanceToObjective === 0) score += 34;
        else if (distanceToObjective === 1) score += 24;
        else if (distanceToObjective === 2) score += 10;
      }
      if (score > 0) {
        const ridgeMultiplier = app.scenario.objectives.alamHalfaRidge.includes(objectiveHexId) ? 1.35 : 1;
        objectiveScores.push(score * ridgeMultiplier);
      }
    }
    return objectiveScores
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((sum, score) => sum + score, 0);
  }

  function alliedObjectiveHoldScore(unit, hexId) {
    if (unit?.side !== "allied" || alliedShouldRelieveObjectiveDefender(unit)) return 0;
    const currentObjective = axisObjectiveHexes().includes(unit.hexId) ? unit.hexId : null;
    if (!currentObjective || !isAxisObjectiveThreatened(currentObjective)) return 0;
    const ridge = app.scenario.objectives.alamHalfaRidge.includes(currentObjective);
    const base = ridge ? 220 : 105;
    const deadline = app.state.turn >= 3 ? 1.35 : 1;
    if (hexId === currentObjective) return base * deadline;
    if (neighborsOf(currentObjective).includes(hexId)) return (ridge ? 30 : 18) * deadline;
    return -(ridge ? 120 : 54) * deadline;
  }

  function alliedObjectiveReliefScore(unit, hexId) {
    if (!alliedShouldRelieveObjectiveDefender(unit)) return 0;
    if (hexId === unit.hexId) return -140;
    const reliefDistance = hexDistance(hexId, unit.hexId);
    if (reliefDistance === 1) return 38;
    if (reliefDistance === 2) return 12;
    return -18;
  }

  function alliedShouldRelieveObjectiveDefender(unit) {
    return unit?.side === "allied"
      && Number(unit.combat || 0) <= 2
      && axisObjectiveHexes().includes(unit.hexId)
      && isAxisObjectiveThreatened(unit.hexId)
      && hasStrongerAlliedReserve(unit, unit.hexId);
  }

  function isAxisObjectiveThreatened(objectiveHexId) {
    const threshold = app.scenario.objectives.alamHalfaRidge.includes(objectiveHexId) ? 9 : 6;
    return liveUnits().some((candidate) => (
      isAxisAssaultUnit(candidate)
      && !candidate.disrupted
      && hexDistance(candidate.hexId, objectiveHexId) <= threshold
    ));
  }

  function hasStrongerAlliedReserve(unit, objectiveHexId) {
    return liveUnits().some((candidate) => (
      candidate.side === "allied"
      && candidate.id !== unit.id
      && !candidate.disrupted
      && Number(candidate.combat || 0) > Number(unit.combat || 0)
      && (Number(candidate.combat || 0) >= 4 || Number(candidate.movement || 0) >= 8)
      && hexDistance(candidate.hexId, objectiveHexId) <= 8
    ));
  }

  function alliedLineCohesionScore(unit, hexId) {
    let score = 0;
    for (const ally of liveUnits().filter((candidate) => candidate.side === "allied" && candidate.id !== unit.id && !candidate.disrupted)) {
      const distance = hexDistance(hexId, ally.hexId);
      if (distance === 2) score += 3.2 + Number(ally.combat || 0) * 0.25;
      else if (distance === 3) score += 1.2;
      else if (distance === 1) score += 0.3;
    }
    return score;
  }

  function attackSetupScore(unit, hexId) {
    let score = 0;
    for (const enemy of liveUnits().filter((candidate) => candidate.side !== unit.side && !candidate.disrupted)) {
      if (!neighborsOf(enemy.hexId).includes(hexId)) continue;
      const support = neighborsOf(enemy.hexId)
        .map(liveUnitAt)
        .filter((ally) => ally && ally.side === unit.side && ally.id !== unit.id && !ally.disrupted)
        .reduce((sum, ally) => sum + Number(ally.combat || 0), 0);
      const attack = Number(unit.combat || 0) + support;
      const defense = Math.max(1, defenseBreakdown(enemy).total);
      const oddsPressure = Math.min(6, attack / defense);
      score += oddsPressure * 2.4 + strategicUnitValueForSide(unit.side, enemy) * 0.08 + Number(enemy.combat || 0) * 0.6;
    }
    return score;
  }

  function zocTrapSetupScore(unit, hexId) {
    let score = 0;
    const hypothetical = { unit, hexId };
    for (const enemy of liveUnits().filter((candidate) => candidate.side !== unit.side && !candidate.disrupted)) {
      const distance = hexDistance(hexId, enemy.hexId);
      if (distance > 2) continue;
      const currentExits = retreatExitCount(enemy, null);
      const trappedExits = retreatExitCount(enemy, hypothetical);
      const reduced = Math.max(0, currentExits - trappedExits);
      const scarcity = Math.max(0, 4 - trappedExits);
      const adjacent = neighborsOf(enemy.hexId).includes(hexId);
      const sealBonus = trappedExits <= 0
        ? 52
        : trappedExits === 1
          ? 20
          : 0;
      const sideWeight = unit.side === "axis" ? 1.45 : 1;
      score += (reduced * 7 + scarcity * 3.4 + sealBonus + strategicUnitValueForSide(unit.side, enemy) * 0.07) * (adjacent ? 1.3 : 0.72) * sideWeight;
    }
    return score;
  }

  function retreatExitCount(unit, hypothetical = null) {
    let count = 0;
    for (const nextId of neighborsOf(unit.hexId)) {
      const nextHex = hexById(nextId);
      if (!terrainRule(nextHex).passable) continue;
      const occupant = liveUnitAtWithHypothetical(nextId, hypothetical);
      if (occupant && occupant.side !== unit.side) continue;
      if (isEnemyZocWithHypothetical(nextId, unit.side, unit.id, hypothetical)) continue;
      count += 1;
    }
    return count;
  }

  function liveUnitAtWithHypothetical(hexId, hypothetical = null) {
    if (hypothetical?.hexId === hexId) return hypothetical.unit;
    const occupant = liveUnitAt(hexId);
    if (occupant && occupant.id === hypothetical?.unit?.id) return null;
    return occupant;
  }

  function isEnemyZocWithHypothetical(hexId, friendlySide, ignoreUnitId = null, hypothetical = null) {
    return liveUnits().some((unit) => {
      if (unit.id === ignoreUnitId || unit.side === friendlySide || unit.disrupted) return false;
      const unitHexId = unit.id === hypothetical?.unit?.id ? hypothetical.hexId : unit.hexId;
      return neighborsOf(unitHexId).includes(hexId);
    });
  }

  function friendlySupportScore(unit, hexId) {
    let score = 0;
    for (const ally of liveUnits().filter((candidate) => candidate.side === unit.side && candidate.id !== unit.id && !candidate.disrupted)) {
      const distance = hexDistance(hexId, ally.hexId);
      if (distance === 1) score += Number(ally.combat || 0) * 1.1;
      else if (distance === 2) score += Number(ally.combat || 0) * 0.35;
    }
    return score;
  }

  function enemyDangerScore(unit, hexId) {
    const adjacentEnemyStrength = neighborsOf(hexId)
      .map(liveUnitAt)
      .filter((enemy) => enemy && enemy.side !== unit.side && !enemy.disrupted)
      .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
    if (!adjacentEnemyStrength) return 0;
    const localSupport = friendlySupportScore(unit, hexId) * 0.45 + Number(unit.combat || 0);
    return Math.max(0, adjacentEnemyStrength - localSupport);
  }

  function strategicHexValueForSide(side, hexId) {
    if (side === "axis") return axisObjectiveScore(hexId) + alliedDefenseScore(hexId) * 0.55;
    return alliedDefenseScore(hexId) + Math.max(0, 10 - nearestDistance(hexId, axisObjectiveHexes())) * 3.5;
  }

  function strategicUnitValueForSide(side, unit) {
    if (!unit) return 0;
    let value = Number(unit.combat || 0) * 3.2 + strategicHexValueForSide(side, unit.hexId) * 0.18;
    if (side === "axis" && unit.side === "allied") {
      const exitDistance = nearestDistance(unit.hexId, app.scenario.objectives.alliedWestExitEdge);
      const allowance = movementAllowance(unit);
      if (exitDistance <= allowance + 2) value += Math.max(0, allowance + 3 - exitDistance) * 8 + (Number(unit.movement || 0) >= 7 ? 10 : 0);
      if (isHighValueAlliedUnit(unit)) value += 16 + Math.max(0, 6 - nearestDistance(unit.hexId, axisObjectiveHexes())) * 4;
    }
    if (side === "allied" && unit.side === "axis") {
      const objectiveDistance = nearestDistance(unit.hexId, axisObjectiveHexes());
      if (objectiveDistance <= 3) value += Math.max(0, 4 - objectiveDistance) * 7 + (Number(unit.combat || 0) >= 4 ? 8 : 0);
    }
    return value;
  }

  function isHighValueAlliedUnit(unit) {
    return unit?.side === "allied" && (Number(unit.combat || 0) >= 4 || Number(unit.movement || 0) >= 7);
  }

  async function declareAiCombats() {
    let declared = 0;
    let guard = 0;
    while (guard < 30) {
      guard += 1;
      if (await declareAiAlphaCombat()) {
        declared += 1;
        continue;
      }
      const tacticalCandidate = bestAiTacticalCombatCandidate();
      const candidate = tacticalCandidate || bestAiCombatCandidate();
      if (!candidate || (!tacticalCandidate && candidate.score < aiCombatThreshold())) break;
      app.state.selectedDefenderId = candidate.defender.id;
      app.state.selectedAttackers = candidate.attackers.map((unit) => unit.id);
      declareBattle();
      declared += 1;
    }
    return declared;
  }

  function aiDeadlineExpired(deadline) {
    return Number(deadline || 0) > 0 && Date.now() >= deadline;
  }

  async function declareAiAlphaCombat() {
    if (!app.core?.ENV_ACTION) return false;
    const action = await chooseAiAlphaAction({
      iterations: 6,
      maxDepth: 1,
      actionLimit: 6,
      preApplyLimit: 18,
      timeBudgetMs: 45,
    });
    if (!action || action.type !== app.core.ENV_ACTION.DECLARE_COMBAT) return false;
    const defender = unitById(action.defenderId);
    const attackers = (action.attackerIds || []).map(unitById).filter(Boolean);
    if (!defender || !attackers.length || attackers.some((attacker) => !canAttack(attacker, defender))) return false;
    app.state.selectedDefenderId = defender.id;
    app.state.selectedAttackers = attackers.map((unit) => unit.id);
    declareBattle();
    return true;
  }

  function bestAiTacticalCombatCandidate() {
    if (!app.aiTactics?.findImmediateTacticalAction || !app.core?.generateLegalActions) return null;
    const environment = aiSearchEnvironment();
    if (!environment) return null;
    const actions = app.core.generateLegalActions(environment, { includeChanceActions: true })
      .filter((action) => action.type === app.core.ENV_ACTION.DECLARE_COMBAT);
    if (!actions.length) return null;
    const tactical = app.aiTactics.findImmediateTacticalAction(environment, actions, { side: activeSide() });
    if (!tactical || tactical.action?.type !== app.core.ENV_ACTION.DECLARE_COMBAT) return null;
    const defender = unitById(tactical.action.defenderId);
    const attackers = tactical.action.attackerIds.map(unitById).filter(Boolean);
    if (!defender || !attackers.length || attackers.some((attacker) => !canAttack(attacker, defender))) return null;
    return {
      defender,
      attackers,
      odds: calculateOdds(attackers, defender),
      score: tactical.score,
      tacticalReason: tactical.reason,
    };
  }

  function bestAiCombatCandidate() {
    let best = null;
    for (const defender of liveUnits().filter((unit) => unit.side !== activeSide() && !unit.disrupted && !app.state.usedDefenders.includes(unit.id))) {
      const attackers = neighborsOf(defender.hexId)
        .map(liveUnitAt)
        .filter((unit) => canAttack(unit, defender))
        .sort((a, b) => Number(b.combat || 0) - Number(a.combat || 0));
      if (!attackers.length) continue;
      const candidate = bestAiAttackerGroup(attackers, defender);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = { ...candidate, defender };
    }
    return best;
  }

  function bestAiAttackerGroup(attackers, defender) {
    let best = null;
    for (const group of aiAttackerGroups(attackers)) {
      const odds = calculateOdds(group, defender);
      const score = scoreAiCombat(group, defender, odds);
      if (!best || score > best.score) best = { attackers: group, odds, score };
    }
    return best;
  }

  function aiAttackerGroups(attackers) {
    const ordered = attackers
      .slice()
      .sort((a, b) => Number(b.combat || 0) - Number(a.combat || 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 6);
    const groups = [];
    const maxMask = 1 << ordered.length;
    for (let mask = 1; mask < maxMask; mask += 1) {
      groups.push(ordered.filter((_, index) => mask & (1 << index)));
    }
    return groups.sort((a, b) => b.reduce((sum, unit) => sum + Number(unit.combat || 0), 0) - a.reduce((sum, unit) => sum + Number(unit.combat || 0), 0));
  }

  function aiCombatThreshold() {
    return app.aiHeuristics.combatDeclarationThreshold({
      side: activeSide(),
      turn: app.state.turn,
    });
  }

  function scoreAiCombat(attackers, defender, odds) {
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const attackerSide = attackers[0]?.side || activeSide();
    const defenderValue = strategicUnitValueForSide(attackerSide, defender);
    const objectiveUrgency = axisObjectiveCombatUrgency(attackerSide, defender.hexId);
    const perimeterUrgency = axisObjectivePerimeterCombatUrgency(attackerSide, attackers, defender.hexId);
    const bridgeheadUrgency = axisBridgeheadCombatUrgency(attackerSide, attackers, defender, odds);
    const counterattackUrgency = alliedObjectiveCombatUrgency(attackerSide, defender.hexId);
    const spearheadUrgency = alliedSpearheadCounterattackUrgency(attackerSide, attackers, defender, odds);
    let total = 0;
    for (const row of Object.values(app.rules.crt.rows)) {
      total += scoreAiCombatResult(row[odds.columnIndex], attackers, defender, defenderValue);
    }
    const overcommit = Math.max(0, attackStrength - Math.max(1, odds.defense) * 4) * 0.28 + Math.max(0, attackers.length - 2) * 0.45;
    const supportPenalty = attackers.some((unit) => enemyDangerScore(unit, unit.hexId) > 4) ? 0.8 : 0;
    const counterattackOddsBonus = counterattackUrgency ? odds.columnIndex * 44 + Math.max(0, attackers.length - 1) * 40 + attackStrength * 6 : 0;
    const spearheadOddsBonus = spearheadUrgency ? odds.columnIndex * 26 + Math.max(0, attackers.length - 1) * 34 + attackStrength * 3.5 : 0;
    const counterattackOvercommit = counterattackUrgency || spearheadUrgency ? overcommit * 0.25 : overcommit;
    const objectiveOddsBonus = axisObjectiveOddsBonus(attackerSide, objectiveUrgency, attackers, odds);
    const perimeterOddsBonus = axisObjectivePerimeterOddsBonus(attackerSide, perimeterUrgency, attackers, odds);
    const coordinatedAttack = coordinatedCombatBonus(attackerSide, attackers, defender, odds);
    return (total / 6) + objectiveUrgency + objectiveOddsBonus + perimeterUrgency + perimeterOddsBonus + bridgeheadUrgency + counterattackUrgency + counterattackOddsBonus + spearheadUrgency + spearheadOddsBonus + coordinatedAttack + odds.columnIndex * 1.1 + strategicHexValueForSide(attackerSide, defender.hexId) * 0.04 - counterattackOvercommit - supportPenalty - combatOverkillPenalty(attackerSide, attackers, defender, odds) - axisBridgeheadLowOddsPenalty(attackerSide, attackers, defender, odds) - axisObjectiveGarrisonAttackPenalty(attackerSide, attackers, defender, odds) - axisObjectiveLowOddsPenalty(attackerSide, objectiveUrgency, attackers, odds) - axisObjectiveDiversionPenalty(attackerSide, attackers, defender) - axisScreenAttackPenalty(attackers, odds) - alliedObjectiveDiversionPenalty(attackerSide, attackers, defender) - alliedSpoilingAttackPenalty(attackerSide, counterattackUrgency + spearheadUrgency, attackers, odds);
  }

  function coordinatedCombatBonus(attackerSide, attackers, defender, odds) {
    if (attackerSide !== "axis") return 0;
    if (attackers.length < 2) return 0;
    const bestSingleOddsColumnIndex = Math.max(...attackers.map((unit) => calculateOdds([unit], defender).columnIndex));
    const targetObjective = axisObjectiveHexes().includes(defender.hexId);
    const targetNearObjective = nearestDistance(defender.hexId, axisObjectiveHexes()) <= 2;
    return app.aiHeuristics.coordinatedAttackScore({
      attackerSide,
      turn: app.state.turn,
      attackerCount: attackers.length,
      attackStrength: attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0),
      defense: odds.defense,
      oddsColumnIndex: odds.columnIndex,
      bestSingleOddsColumnIndex,
      mobileUnits: attackerSide === "axis"
        ? attackers.filter((unit) => isAxisAssaultUnit(unit)).length
        : attackers.filter((unit) => Number(unit.movement || 0) >= 7).length,
      targetObjective,
      targetNearObjective,
    });
  }

  function axisObjectiveCombatUrgency(attackerSide, defenderHexId) {
    if (attackerSide !== "axis") return 0;
    const objectives = app.scenario.objectives;
    const onRidge = objectives.alamHalfaRidge.includes(defenderHexId);
    const onRoad = objectives.coastalRoadEast.includes(defenderHexId);
    if (!onRidge && !onRoad) return 0;
    const base = onRidge ? 130 : 105;
    const deadline = app.state.turn >= 4 ? 430 : app.state.turn === 3 ? 210 : 60;
    return base + deadline;
  }

  function axisObjectivePerimeterCombatUrgency(attackerSide, attackers, defenderHexId) {
    if (attackerSide !== "axis" || app.state.turn < 3) return 0;
    const occupiedObjective = axisObjectiveHexes().find((objectiveHexId) => {
      const occupant = liveUnitAt(objectiveHexId);
      return occupant?.side === "axis" && neighborsOf(objectiveHexId).includes(defenderHexId);
    });
    if (!occupiedObjective) return 0;
    const adjacentAlliedThreat = neighborsOf(occupiedObjective)
      .map(liveUnitAt)
      .filter((enemy) => enemy && enemy.side === "allied" && !enemy.disrupted)
      .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
    const nonObjectiveAttackers = attackers.filter((unit) => !axisObjectiveHexes().includes(unit.hexId)).length;
    const objectiveAttackers = attackers.length - nonObjectiveAttackers;
    const base = app.state.turn >= 4 ? 210 : 118;
    return base + adjacentAlliedThreat * 12 + nonObjectiveAttackers * 72 - objectiveAttackers * 18;
  }

  function axisObjectivePerimeterOddsBonus(attackerSide, perimeterUrgency, attackers, odds) {
    if (attackerSide !== "axis" || !perimeterUrgency) return 0;
    const nonObjectiveAttackers = attackers.filter((unit) => !axisObjectiveHexes().includes(unit.hexId)).length;
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const timing = app.state.turn >= 4 ? 1.35 : 1;
    return (odds.columnIndex * 22 + nonObjectiveAttackers * 46 + attackStrength * 1.8) * timing;
  }

  function axisBridgeheadCombatUrgency(attackerSide, attackers, defender, odds) {
    if (attackerSide !== "axis" || app.state.turn < 3) return 0;
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    let best = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const occupant = liveUnitAt(objectiveHexId);
      if (occupant?.side !== "axis") continue;
      const defenderDistance = hexDistance(defender.hexId, objectiveHexId);
      if (defenderDistance > 2) continue;
      const perimeterAttack = attackers.some((unit) => hexDistance(unit.hexId, objectiveHexId) <= 1);
      if (!perimeterAttack) continue;
      const objectiveGarrisonAttack = attackers.some((unit) => unit.hexId === objectiveHexId);
      const oddsDiscipline = odds.columnIndex >= 4 ? 1.22 : odds.columnIndex === 3 ? 0.42 : odds.columnIndex >= 2 ? 0.16 : 0.06;
      const base = defenderDistance === 1 ? 330 : 112;
      const threatValue = Number(defender.combat || 0) * (defenderDistance === 1 ? 24 : 12);
      const groupValue = Math.max(0, attackers.length - 1) * 34 + attackStrength * 5.2;
      const garrisonValue = objectiveGarrisonAttack ? 84 : 0;
      best = Math.max(best, (base + threatValue + groupValue + garrisonValue) * oddsDiscipline);
    }
    return Math.min(680, best);
  }

  function axisBridgeheadLowOddsPenalty(attackerSide, attackers, defender, odds) {
    if (attackerSide !== "axis" || app.state.turn < 3 || odds.columnIndex >= 4) return 0;
    let penalty = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const occupant = liveUnitAt(objectiveHexId);
      if (occupant?.side !== "axis") continue;
      if (hexDistance(defender.hexId, objectiveHexId) > 2) continue;
      if (!attackers.some((unit) => hexDistance(unit.hexId, objectiveHexId) <= 2)) continue;
      const timing = app.state.turn >= 4 ? 1.45 : 1;
      const soloRisk = attackers.length === 1 ? 110 : 0;
      const garrisonRisk = attackers.some((unit) => unit.hexId === objectiveHexId) ? 160 : 0;
      penalty = Math.max(penalty, ((4 - odds.columnIndex) * 175 + soloRisk + garrisonRisk) * timing);
    }
    return penalty;
  }

  function axisObjectiveGarrisonAttackPenalty(attackerSide, attackers, defender, odds) {
    if (attackerSide !== "axis" || app.state.turn < 3) return 0;
    const garrisonAttackers = attackers.filter((unit) => axisObjectiveHexes().includes(unit.hexId));
    if (!garrisonAttackers.length) return 0;
    const targetObjective = axisObjectiveHexes().includes(defender.hexId);
    const objectiveThreat = garrisonAttackers.some((unit) => {
      const adjacentAlliedThreat = neighborsOf(unit.hexId)
        .map(liveUnitAt)
        .filter((enemy) => enemy && enemy.side === "allied" && !enemy.disrupted)
        .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
      return adjacentAlliedThreat >= 6;
    });
    const nonGarrisonAttackers = attackers.length - garrisonAttackers.length;
    const timing = app.state.turn >= 4 ? 1.35 : 1;
    if (nonGarrisonAttackers === 0 && odds.columnIndex < 4) return 900 * timing;
    const base = targetObjective ? 135 : objectiveThreat ? 92 : 240;
    const oddsRisk = odds.columnIndex < 4 ? (4 - odds.columnIndex) * 62 : 0;
    const soloRisk = nonGarrisonAttackers === 0 ? (targetObjective ? 190 : 120) : 0;
    const supportRelief = Math.min(90, nonGarrisonAttackers * 36);
    return Math.max(0, (base + oddsRisk + soloRisk - supportRelief) * timing);
  }

  function combatOverkillPenalty(attackerSide, attackers, defender, odds) {
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const retreatPressure = defenderRetreatPressure(defender, 1);
    const surrounded = retreatPressure >= 5;
    const mobileUnits = attackerSide === "axis"
      ? attackers.filter((unit) => isAxisAssaultUnit(unit)).length
      : attackers.filter((unit) => Number(unit.movement || 0) >= 7).length;
    return app.aiHeuristics.combatOvercommitPenalty({
      attackerSide,
      attackStrength,
      defense: odds.defense,
      oddsColumnIndex: odds.columnIndex,
      attackerCount: attackers.length,
      attackerStrengths: attackers.map((unit) => Number(unit.combat || 0)),
      mobileUnits,
      surrounded,
      earlyNoExtraRelief: attackerSide === "axis" && app.state.turn <= 2 ? 0.5 : 1,
    });
  }

  function alliedObjectiveCombatUrgency(attackerSide, defenderHexId) {
    if (attackerSide !== "allied") return 0;
    const objectiveDistance = nearestDistance(defenderHexId, axisObjectiveHexes());
    if (objectiveDistance === 0) return app.state.turn >= 3 ? 360 : 260;
    if (objectiveDistance === 1) return app.state.turn >= 3 ? 120 : 70;
    return 0;
  }

  function alliedSpearheadCounterattackUrgency(attackerSide, attackers, defender, odds) {
    if (attackerSide !== "allied" || defender.side !== "axis" || !isAxisAssaultUnit(defender)) return 0;
    const objectiveDistance = nearestDistance(defender.hexId, axisObjectiveHexes());
    if (objectiveDistance > 4) return 0;
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const defenderDefense = Math.max(1, defenseBreakdown(defender).total);
    if (attackers.length === 1 && attackStrength < defenderDefense * 1.5) return 0;
    if (odds.columnIndex < 2 && attackers.length < 2) return 0;
    const localAllied = liveUnits().filter((unit) => unit.side === "allied" && !unit.disrupted && hexDistance(unit.hexId, defender.hexId) <= 2);
    const nearbyAxisAssault = liveUnits().filter((unit) => isAxisAssaultUnit(unit) && unit.id !== defender.id && hexDistance(unit.hexId, defender.hexId) <= 2).length;
    const nearbyAxisSupport = liveUnits()
      .filter((unit) => unit.side === "axis" && unit.id !== defender.id && !unit.disrupted && hexDistance(unit.hexId, defender.hexId) <= 2)
      .reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const overextendedBonus = nearbyAxisSupport <= 4 ? 96 : nearbyAxisSupport <= 8 ? 42 : 0;
    const localBalance = Math.max(0, attackStrength + localAllied.length * 2 - nearbyAxisSupport) * 5.5;
    const lineThreat = Math.max(0, 5 - objectiveDistance) * 42 + Math.max(0, localAllied.length - nearbyAxisAssault) * 20;
    const oddsDiscipline = odds.columnIndex >= 2 ? 1 : 0.42;
    const groupBonus = attackers.length >= 2 ? 58 : attackers.length === 1 ? -18 : 0;
    return Math.max(0, (lineThreat + groupBonus + overextendedBonus + localBalance + Math.max(0, attackStrength - defenderDefense) * 7) * oddsDiscipline);
  }

  function alliedSpoilingAttackPenalty(attackerSide, counterattackUrgency, attackers, odds) {
    if (attackerSide !== "allied" || counterattackUrgency) return 0;
    const lowOddsPenalty = odds.columnIndex < 3 ? (3 - odds.columnIndex) * 28 : 0;
    const singleUnitPenalty = attackers.length === 1 ? 24 : 0;
    const weakUnitPenalty = attackers.some((unit) => Number(unit.combat || 0) <= 2) ? 18 : 0;
    return lowOddsPenalty + singleUnitPenalty + weakUnitPenalty;
  }

  function alliedObjectiveDiversionPenalty(attackerSide, attackers, defender) {
    if (attackerSide !== "allied" || axisObjectiveHexes().includes(defender.hexId)) return 0;
    const occupiedObjectives = axisObjectiveHexes().filter((hexId) => liveUnitAt(hexId)?.side === "axis");
    if (!occupiedObjectives.length) return 0;
    let penalty = 0;
    for (const attacker of attackers) {
      const guardsOccupiedObjective = occupiedObjectives.some((objectiveHexId) => neighborsOf(objectiveHexId).includes(attacker.hexId));
      if (!guardsOccupiedObjective) continue;
      penalty += (app.state.turn >= 3 ? 220 : 160) + Number(attacker.combat || 0) * 10;
    }
    return Math.min(520, penalty);
  }

  function axisObjectiveOddsBonus(attackerSide, objectiveUrgency, attackers, odds) {
    if (attackerSide !== "axis" || !objectiveUrgency) return 0;
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const grouped = Math.min(1, Math.max(0, attackers.length - 1)) * 8;
    const oddsBonus = odds.columnIndex * (app.state.turn >= 4 ? 30 : 20);
    return grouped + oddsBonus + Math.min(attackStrength, Math.max(1, odds.defense) * 4) * 2.2;
  }

  function axisObjectiveLowOddsPenalty(attackerSide, objectiveUrgency, attackers, odds) {
    if (attackerSide !== "axis" || !objectiveUrgency || odds.columnIndex >= 2) return 0;
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const pressure = app.state.turn >= 4 ? 0.45 : app.state.turn === 3 ? 1 : 1.25;
    const singleUnitPenalty = attackers.length === 1 ? 76 : 0;
    const assaultRisk = attackers.some(isAxisAssaultUnit) ? 38 : 0;
    return ((2 - odds.columnIndex) * 150 + singleUnitPenalty + assaultRisk + attackStrength * 3) * pressure;
  }

  function axisObjectiveDiversionPenalty(attackerSide, attackers, defender) {
    if (attackerSide !== "axis" || app.state.turn < 3 || axisObjectiveHexes().includes(defender.hexId)) return 0;
    let penalty = 0;
    for (const attacker of attackers) {
      if (!isAxisAssaultUnit(attacker)) continue;
      const adjacentObjective = axisObjectiveHexes().some((objectiveHexId) => {
        const occupant = liveUnitAt(objectiveHexId);
        return occupant?.side === "allied" && neighborsOf(objectiveHexId).includes(attacker.hexId);
      });
      if (adjacentObjective) penalty += (app.state.turn >= 4 ? 180 : 92) + Number(attacker.combat || 0) * 4;
    }
    return Math.min(app.state.turn >= 4 ? 520 : 260, penalty);
  }

  function axisScreenAttackPenalty(attackers, odds) {
    if (attackers[0]?.side !== "axis") return 0;
    let penalty = 0;
    for (const attacker of attackers) {
      if (isAxisAssaultUnit(attacker)) continue;
      const coverage = axisExitCoverageScore(attacker.hexId, attacker.id);
      if (coverage <= 20) continue;
      const oddsRisk = Math.max(0, 4 - odds.columnIndex);
      penalty += Math.min(180, coverage * 0.82) * (1 + oddsRisk * 0.35);
    }
    return penalty;
  }

  function scoreAiCombatResult(result, attackers, defender, defenderValue) {
    const attackStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
    const attackerSide = attackers[0]?.side || activeSide();
    const attackerValue = attackStrength * 2.7 + attackers.reduce((sum, unit) => sum + strategicHexValueForSide(attackerSide, unit.hexId) * 0.03, 0);
    if (result === "DE") return defenderValue * 8.5 + strategicHexValueForSide(attackerSide, defender.hexId) * 0.7;
    if (result === "AE") return -attackerValue * 8.2;
    if (result === "AR") {
      const tempoRisk = attackerSide === "axis" && app.state.turn <= 2 && attackers.some(isAxisAssaultUnit) ? 2.65 : 1.85;
      return -attackerValue * tempoRisk;
    }
    const retreat = result.match(/^DR(\d+)$/);
    if (retreat) {
      const retreatSteps = Number(retreat[1]);
      const pressure = defenderRetreatPressure(defender, retreatSteps);
      return defenderValue * (2.05 + retreatSteps * 0.42 + pressure) + strategicHexValueForSide(attackerSide, defender.hexId) * (0.22 + pressure * 0.08);
    }
    return 0;
  }

  function defenderRetreatPressure(defender, steps) {
    const paths = legalRetreatPaths(defender, steps, defender.hexId);
    const count = paths.size;
    if (count === 0) return 5.6;
    if (count === 1) return 3.1;
    if (count === 2) return 2.2;
    if (count <= 4) return 1.25;
    return Math.max(0, (7 - count) * 0.16);
  }

  function chooseAiRetreatDestination(unit) {
    const controllerSide = retreatControllerSide();
    const maximizeForRetreater = controllerSide === unit.side;
    let best = null;
    for (const [hexId, path] of app.retreatPaths.entries()) {
      const route = { remaining: 0, path };
      const retreaterScore = scoreAiHex(unit, hexId, route) - path.length * 0.25 + friendlySupportScore(unit, hexId) * 0.35 - enemyDangerScore(unit, hexId) + ownRetreatHoldScore(unit, hexId);
      const controllerScore = maximizeForRetreater ? retreaterScore : -retreaterScore + forcedRetreatDenialScore(controllerSide, unit, hexId);
      if (!best || controllerScore > best.score) best = { hexId, score: controllerScore };
    }
    return best?.hexId || null;
  }

  function forcedRetreatDenialScore(controllerSide, unit, hexId) {
    const trapScore = forcedRetreatTrapScore(controllerSide, unit, hexId);
    if (controllerSide === "axis" && unit.side === "allied") {
      const exitDistance = nearestDistance(hexId, app.scenario.objectives.alliedWestExitEdge);
      const allowance = Math.max(movementAllowance(unit), Number(unit.movement || 0));
      let score = Math.min(exitDistance, 12) * 5;
      if (exitDistance < allowance) score -= 180 + (allowance - exitDistance) * 35;
      else if (exitDistance <= allowance + 1) score -= 60;
      return score + trapScore - strategicHexValueForSide("allied", hexId) * 0.08;
    }
    if (controllerSide === "allied" && unit.side === "axis") {
      const objectiveDistance = nearestDistance(hexId, axisObjectiveHexes());
      return objectiveDistance * 6
        + trapScore
        - strategicHexValueForSide("axis", hexId) * 0.12
        + app.aiHeuristics.forcedRetreatObjectiveDenialScore({
          controllerSide,
          retreatingSide: unit.side,
          isAxisObjective: axisObjectiveHexes().includes(hexId),
          axisObjectiveDistance: objectiveDistance,
        });
    }
    return trapScore + strategicHexValueForSide(controllerSide, hexId) * 0.02;
  }

  function forcedRetreatTrapScore(controllerSide, unit, hexId) {
    const hypothetical = { unit, hexId };
    return app.aiHeuristics.forcedRetreatTrapScore({
      retreatExitCount: retreatExitCount(unit, hypothetical),
      adjacentControllerStrength: adjacentSideStrength(controllerSide, hexId),
      controllerZocCount: sideZocCount(controllerSide, hexId),
      enemyObjectiveDistance: nearestDistance(hexId, axisObjectiveHexes()),
      enemyExitDistance: unit.side === "allied" ? nearestDistance(hexId, app.scenario.objectives.alliedWestExitEdge) : 0,
      highValueEnemy: unit.side === "axis" ? isAxisAssaultUnit(unit) : isHighValueAlliedUnit(unit),
    });
  }

  function ownRetreatHoldScore(unit, hexId) {
    if (unit.side !== "axis") return 0;
    return app.aiHeuristics.objectiveRetreatHoldScore({
      isObjective: axisObjectiveHexes().includes(hexId),
      combat: Number(unit.combat || 0),
      supportStrength: sideStrengthWithin("axis", hexId, 2, unit.id),
      adjacentSupportCount: sideUnitsWithin("axis", hexId, 1, unit.id).length,
      counterattackThreat: counterattackThreatAgainstHex("allied", hexId),
    });
  }

  function adjacentSideStrength(side, hexId) {
    return neighborsOf(hexId)
      .map(liveUnitAt)
      .filter((unit) => unit && unit.side === side && !unit.disrupted)
      .reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
  }

  function sideZocCount(side, hexId) {
    return neighborsOf(hexId).filter((neighborId) => (
      liveUnits().some((unit) => unit.side === side && !unit.disrupted && neighborsOf(unit.hexId).includes(neighborId))
    )).length;
  }

  function sideUnitsWithin(side, hexId, radius, ignoreUnitId = null) {
    return liveUnits().filter((unit) => (
      unit.id !== ignoreUnitId
      && unit.side === side
      && !unit.disrupted
      && hexDistance(unit.hexId, hexId) <= radius
    ));
  }

  function sideStrengthWithin(side, hexId, radius, ignoreUnitId = null) {
    return sideUnitsWithin(side, hexId, radius, ignoreUnitId)
      .reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
  }

  function counterattackThreatAgainstHex(side, hexId) {
    return liveUnits()
      .filter((unit) => unit.side === side && !unit.disrupted)
      .reduce((sum, unit) => {
        const distance = hexDistance(unit.hexId, hexId);
        const reach = Math.max(movementAllowance(unit), Number(unit.movement || 0)) + 1;
        if (distance > reach) return sum;
        return sum + Number(unit.combat || 0) * (distance <= 2 ? 1.2 : 1);
      }, 0);
  }

  function chooseAiAdvanceUnit() {
    const task = app.state.advanceTask;
    if (!task) return null;
    let best = null;
    for (const id of task.attackerIds) {
      const unit = unitById(id);
      if (!unit || unit.eliminated) continue;
      const score = scoreAiHex(unit, task.targetHexId, { remaining: 0, path: [unit.hexId, task.targetHexId] })
        - scoreAiHex(unit, unit.hexId, { remaining: 0, path: [unit.hexId] })
        + axisAdvanceObjectiveScore(unit, unit.hexId, task.targetHexId)
        + axisAdvancePerimeterScore(unit, unit.hexId, task.targetHexId)
        + Number(unit.movement || 0) * 0.15;
      if (!best || score > best.score) best = { id, score };
    }
    return best && best.score > 0 ? best.id : null;
  }

  function chooseAiTacticalAdvanceUnit() {
    if (!app.aiTactics?.findImmediateTacticalAction || !app.core?.generateLegalActions) return null;
    const environment = aiSearchEnvironment();
    if (!environment) return null;
    const actions = app.core.generateLegalActions(environment, { includeChanceActions: true })
      .filter((action) => action.type === app.core.ENV_ACTION.ADVANCE_UNIT || action.type === app.core.ENV_ACTION.SKIP_ADVANCE);
    const tactical = app.aiTactics.findImmediateTacticalAction(environment, actions, { side: activeSide() });
    return tactical?.action?.type === app.core.ENV_ACTION.ADVANCE_UNIT ? tactical.action.unitId : null;
  }

  function axisAdvanceObjectiveScore(unit, fromHexId, toHexId) {
    if (unit.side !== "axis") return 0;
    const fromObjective = axisObjectiveHexes().includes(fromHexId);
    const toObjective = axisObjectiveHexes().includes(toHexId);
    let score = 0;
    if (fromObjective && app.state.turn >= 3) return -10000;
    if (toObjective && !fromObjective) score += 220;
    else if (toObjective) score -= app.state.turn >= 3 ? 180 : 70;
    if (fromObjective && !toObjective) score -= app.state.turn >= 3 ? 280 : 150;
    return score;
  }

  function axisAdvancePerimeterScore(unit, fromHexId, toHexId) {
    if (unit.side !== "axis" || app.state.turn < 3 || axisObjectiveHexes().includes(toHexId)) return 0;
    if (axisObjectiveHexes().includes(fromHexId)) return -10000;
    let score = 0;
    for (const objectiveHexId of axisObjectiveHexes()) {
      const occupant = liveUnitAt(objectiveHexId);
      if (occupant?.side !== "axis" || !neighborsOf(objectiveHexId).includes(toHexId)) continue;
      const adjacentAlliedThreat = neighborsOf(objectiveHexId)
        .map(liveUnitAt)
        .filter((enemy) => enemy && enemy.side === "allied" && !enemy.disrupted)
        .reduce((sum, enemy) => sum + Number(enemy.combat || 0), 0);
      score += (app.state.turn >= 4 ? 160 : 92) + Math.min(70, adjacentAlliedThreat * 8) + Number(unit.combat || 0) * 5;
    }
    return score;
  }

  function endPhase() {
    if (app.state.winner) return;
    if (app.phaseFlow.shouldConfirmEmptyMovementPhaseEnd({
      phase: phase(),
      movedUnits: app.state.movedUnits,
    }) && !window.confirm(tr("ui.confirmEmptyMovementPhaseEnd"))) {
      return;
    }
    if (isOnlineMatch()) {
      void submitOnlineGameAction({ type: app.core.ENV_ACTION.END_PHASE });
      return;
    }
    if (app.state.retreatTask || app.state.advanceTask) {
      log(tr("text.retreatPrompt", { unit: "" }));
      draw();
      return;
    }
    if (isCombatPhase() && app.state.combatMode === "resolve" && hasPendingBattles()) {
      log(tr("text.pendingCombat"));
      draw();
      return;
    }
    if (isCombatPhase() && app.state.combatMode === "declare" && app.state.declaredCombats.length) {
      log(tr("ui.finishDeclarations"));
      draw();
      return;
    }
    if (app.phaseFlow.shouldConfirmEmptyMovementPhaseEnd({
      phase: phase(),
      movedUnits: app.state.movedUnits,
    }) && !window.confirm(tr("ui.confirmEmptyMovementPhaseEnd"))) {
      return;
    }
    const eventStateBefore = clone(app.state);
    if (PRODUCT_PROFILE.features.humanLabCaptureIntegrity) {
      recordHumanDemonstrationDecision({ type: app.core.ENV_ACTION.END_PHASE }, eventStateBefore);
    }
    const endedPhaseId = phase().id;
    const endedTurn = app.state.turn;
    app.ai.waitingForHuman = false;
    app.ai.scheduled = false;
    if (isCombatPhase()) recoverSide(activeSide());
    clearPhaseState();
    const fullTurnEnd = app.core.shouldCheckAxisObjectiveVictoryAtPhaseEnd({
      phaseIndex: app.state.phaseIndex,
      phases: app.rules.phases,
    });
    if (fullTurnEnd) {
      if (checkAxisObjectiveVictory()) {
        recordTrainingEvent("PHASE_ENDED", eventStateBefore, {
          phaseId: endedPhaseId,
          endedTurn,
          fullTurnEnd: true,
          endedWithWinner: true,
        });
        recordGameEndedEvent(eventStateBefore, { causedBy: "AXIS_OBJECTIVE" });
        draw();
        return;
      }
      if (app.state.turn >= app.rules.turns.length) {
        setWinner("allied", tr("text.fourTurnWin"), "axis-failed");
        recordTrainingEvent("PHASE_ENDED", eventStateBefore, {
          phaseId: endedPhaseId,
          endedTurn,
          fullTurnEnd: true,
          endedWithWinner: true,
        });
        recordGameEndedEvent(eventStateBefore, { causedBy: "AXIS_FAILED" });
      } else {
        app.state.turn += 1;
        app.state.phaseIndex = 0;
        log(tr("text.turnStart", { turn: app.state.turn }));
        saveTurnCheckpoint();
        recordTrainingEvent("PHASE_ENDED", eventStateBefore, {
          phaseId: endedPhaseId,
          endedTurn,
          fullTurnEnd: true,
          nextPhaseId: phase().id,
          nextTurn: app.state.turn,
        });
        recordTrainingEvent("PHASE_STARTED", app.state, {
          phaseId: phase().id,
          turn: app.state.turn,
        });
      }
    } else {
      app.state.phaseIndex += 1;
      log(tr("text.enterPhase", { phase: phaseLabel(phase().id) }));
      if (checkAlliedBreakthroughVictory()) {
        recordTrainingEvent("PHASE_ENDED", eventStateBefore, {
          phaseId: endedPhaseId,
          endedTurn,
          fullTurnEnd: false,
          nextPhaseId: phase().id,
          endedWithWinner: true,
        });
        recordGameEndedEvent(eventStateBefore, { causedBy: "ALLIED_BREAKTHROUGH_READY" });
        draw();
        return;
      }
      recordTrainingEvent("PHASE_ENDED", eventStateBefore, {
        phaseId: endedPhaseId,
        endedTurn,
        fullTurnEnd: false,
        nextPhaseId: phase().id,
        nextTurn: app.state.turn,
      });
      recordTrainingEvent("PHASE_STARTED", app.state, {
        phaseId: phase().id,
        turn: app.state.turn,
      });
    }
    draw();
  }

  function clearPhaseState() {
    app.focusedBattleId = null;
    app.state.selectedUnitId = null;
    app.state.selectedDefenderId = null;
    app.state.selectedAttackers = [];
    app.state.declaredCombats = [];
    app.state.combatCompleteNotified = false;
    app.state.usedAttackers = [];
    app.state.usedDefenders = [];
    app.state.movedUnits = [];
    app.state.lastMove = null;
    app.state.lastCombatResult = null;
    app.state.combatMode = "declare";
    app.reachable.clear();
    app.legalRetreats.clear();
    app.legalRetreatSteps.clear();
    app.retreatPaths.clear();
  }

  function recoverSide(side) {
    for (const unit of app.state.units) {
      if (!unit.eliminated && unit.side === side && unit.disrupted) {
        unit.disrupted = false;
        log(tr("text.recover", { unit: unitName(unit) }));
      }
    }
  }

  function checkAxisObjectiveVictory() {
    const victory = app.core.evaluateAxisObjectiveVictory(coreContext());
    if (victory) {
      const unit = unitById(victory.unitId);
      const reasonKey = victory.reason === "ridge" ? "text.ridgeWin" : "text.roadWin";
      setWinner(victory.side, tr(reasonKey, { unit: unitName(unit) }), victory.type);
      return true;
    }
    return false;
  }

  function checkAlliedBreakthroughVictory() {
    if (app.state.winner || !isMovementPhase() || activeSide() !== "allied") return false;
    const victory = app.core.evaluateAlliedBreakthroughVictory(coreContext(), app.state.movedUnits);
    if (!victory) return false;
    const unit = unitById(victory.unitId);
    setWinner(victory.side, tr("text.exitWin", { unit: unitName(unit) }), victory.type);
    return true;
  }

  function setWinner(side, reason, type = null) {
    app.state.winner = { side, reason, type, turn: app.state.turn, report: buildAarData(side, reason, type) };
    completeHumanDemonstrationRecording();
    log(`${sideLabel(side)}: ${reason}`);
    openAar(true);
  }

  function buildAarData(side = app.state.winner?.side || null, reason = app.state.winner?.reason || tr("aar.pendingTitle"), type = app.state.winner?.type || null) {
    const eliminated = app.state.eliminatedUnitIds.map(unitById).filter(Boolean);
    const eliminatedBySide = {
      axis: eliminated.filter((unit) => unit.side === "axis"),
      allied: eliminated.filter((unit) => unit.side === "allied"),
    };
    const objectiveStatus = app.core.getObjectiveStatus(coreContext());
    return {
      side,
      reason,
      type,
      turn: app.state.turn,
      eliminated,
      eliminatedBySide,
      initialStrength: clone(app.state.initialStrength || totalStrengthBySide(app.scenario.units)),
      currentStrength: totalStrengthBySide(app.state.units),
      losses: clone(app.state.losses),
      objectives: {
        ridgeOccupied: objectiveStatus.ridgeOccupied,
        ridgeTotal: objectiveStatus.ridgeTotal,
        ridgeControl: objectiveStatus.ridgeControl,
        ridgeFullControl: objectiveStatus.ridgeFullControl,
        roadOccupied: objectiveStatus.roadOccupied,
        elAlameinOccupied: objectiveStatus.elAlameinOccupied,
        roadCut: objectiveStatus.roadCut,
      },
      battles: clone(app.state.battleReports),
    };
  }

  function openAar(final = false) {
    renderAar(final);
    setView("aar");
  }

  function renderAar() {
    const data = buildAarData();
    const winnerSide = app.state.winner?.side || "";
    el.aarView.dataset.winner = winnerSide || "pending";
    el.aarTitle.textContent = app.state.winner ? tr("aar.title", { side: sideLabel(winnerSide) }) : tr("aar.pendingTitle");
    el.aarSubtitle.textContent = tr("aar.subtitle", { turn: data.turn, reason: data.reason });
    el.aarSummary.replaceChildren(
      victoryImpactCard(data.side),
      objectivesCard(data),
    );
    el.aarLosses.replaceChildren(casualtyReportCard(data));
    el.aarEliminated.replaceChildren();
    renderBattleRecordSection(data.battles);
  }

  function sectionTitle(text) {
    const node = document.createElement("div");
    node.className = "aar-card";
    const strong = document.createElement("strong");
    strong.textContent = text;
    node.append(strong);
    return node;
  }

  function aarCard(title, body) {
    const card = document.createElement("div");
    card.className = "aar-card";
    if (title) {
      const strong = document.createElement("strong");
      strong.textContent = title;
      card.append(strong);
    }
    if (body instanceof Node) {
      card.append(body);
    } else {
      const span = document.createElement("span");
      span.textContent = body;
      card.append(span);
    }
    return card;
  }

  function victoryImpactCard(side) {
    const body = document.createElement("span");
    if (side === "axis") {
      body.textContent = tr("text.axisImpact");
    } else if (side === "allied") {
      body.append(document.createTextNode(tr("text.alliedImpactPrefix")));
      body.append(document.createTextNode(tr("text.alliedImpactLink")));
      body.append(document.createTextNode(tr("text.alliedImpactSuffix")));
    } else {
      body.textContent = "--";
    }
    const card = aarCard("", body);
    card.classList.add("aar-impact-card");
    return card;
  }

  function objectivesCard(data) {
    const body = document.createElement("div");
    body.className = "objective-status";
    const achieved = objectiveAchievements(data);
    if (achieved.length) {
      achieved.forEach((item) => body.append(objectiveLine(item.title, item.text)));
    } else {
      body.append(objectiveLine(tr("text.objectives"), tr("text.noObjectiveReached")));
    }
    const card = aarCard(tr("text.objectives"), body);
    card.classList.add("objectives-card");
    return card;
  }

  function objectiveAchievements(data) {
    const objectives = data.objectives;
    const achieved = [];
    if (data.side === "allied") {
      if (data.type === "allied-breakthrough") {
        achieved.push({ title: tr("text.alliedBreakthroughTitle"), text: tr("text.alliedBreakthroughText") });
      } else {
        achieved.push({ title: tr("text.axisFailedTitle"), text: tr("text.axisFailedText") });
      }
      return achieved;
    }
    if (objectives.ridgeFullControl) {
      achieved.push({ title: tr("text.ridgeFullTitle"), text: tr("text.ridgeFullText") });
    } else if (objectives.ridgeControl) {
      achieved.push({ title: tr("text.ridgeControlTitle"), text: tr("text.ridgeControlText") });
    }
    if (objectives.roadCut) {
      achieved.push({ title: tr("text.roadCutTitle"), text: tr("text.roadCutText") });
    }
    if (objectives.elAlameinOccupied) {
      achieved.push({ title: tr("text.roadElAlameinTitle"), text: tr("text.roadElAlameinText") });
    }
    return achieved;
  }

  function objectiveLine(label, value) {
    const row = document.createElement("div");
    row.className = "objective-line";
    const name = document.createElement("span");
    name.textContent = label;
    const status = document.createElement("strong");
    status.textContent = value;
    row.append(name, status);
    return row;
  }

  function casualtyReportCard(data) {
    const body = document.createElement("div");
    body.className = "casualty-report";
    body.append(casualtySideCard("axis", data), casualtySideCard("allied", data));
    const card = aarCard(tr("text.casualtyReport"), body);
    card.classList.add("casualty-report-card");
    return card;
  }

  function casualtySideCard(side, data) {
    const targetSide = enemySide(side);
    const sideBox = document.createElement("section");
    sideBox.className = "casualty-side";
    sideBox.dataset.side = side;
    const heading = document.createElement("h3");
    heading.textContent = sideLabel(side);
    const loss = data.losses[targetSide] || { units: 0, combat: 0 };
    const stats = document.createElement("div");
    stats.className = "casualty-stats";
    [
      [tr("text.initialStrength"), data.initialStrength[side] ?? 0],
      [tr("text.currentStrength"), data.currentStrength[side] ?? 0],
      [tr("text.eliminatedUnits"), loss.units],
      [tr("text.lostStrength"), loss.combat],
    ].forEach(([label, value]) => {
      const item = document.createElement("span");
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("b");
      strong.textContent = value;
      item.append(small, strong);
      stats.append(item);
    });

    const groups = document.createElement("div");
    groups.className = "casualty-groups";
    casualtyGroupsForSide(targetSide, data.eliminatedBySide[targetSide] || []).forEach((group) => {
      groups.append(casualtyGroupLine(group.label, group.units));
    });
    sideBox.append(heading, stats, groups);
    return sideBox;
  }

  function casualtyGroupsForSide(side, units) {
    if (side === "axis") {
      return [
        { label: tr("text.germanGroup"), units: units.filter((unit) => unit.nationality === "german") },
        { label: tr("text.italianGroup"), units: units.filter((unit) => unit.nationality === "italian") },
      ];
    }
    return [{ label: tr("text.commonwealthGroup"), units }];
  }

  function casualtyGroupLine(label, units) {
    const line = document.createElement("div");
    line.className = "casualty-group";
    const heading = document.createElement("strong");
    heading.textContent = label;
    const list = document.createElement("div");
    list.className = "casualty-unit-list";
    const sorted = [...units].sort((a, b) => Number(isMechanizedUnit(b)) - Number(isMechanizedUnit(a)) || unitName(a).localeCompare(unitName(b)));
    if (!sorted.length) {
      const none = document.createElement("span");
      none.className = "casualty-none";
      none.textContent = tr("text.noEliminated");
      list.append(none);
    } else {
      sorted.forEach((unit) => list.append(casualtyUnitToken(unit)));
    }
    line.append(heading, list);
    return line;
  }

  function casualtyUnitToken(unit) {
    const token = document.createElement("span");
    token.className = "casualty-unit";
    token.dataset.mechanized = String(isMechanizedUnit(unit));
    const image = document.createElement("img");
    image.src = unit.image;
    image.alt = unitName(unit);
    const text = document.createElement("span");
    text.textContent = `${isMechanizedUnit(unit) ? tr("text.mechanizedTag") : tr("text.nonMechanizedTag")} · ${unitName(unit)} (${unit.combat})`;
    token.append(image, text);
    return token;
  }

  function isMechanizedUnit(unit) {
    if (!unit) return false;
    if (["armor", "mechanized"].includes(unit.unitType)) return true;
    const text = `${unit.name || ""} ${UNIT_EN[unit.id] || ""}`.toLowerCase();
    return /装甲|机械化|motor|armou?r|panzer|mechanized|mechanised/.test(text);
  }

  function renderBattleRecordSection(battles) {
    el.aarBattles.replaceChildren(sectionTitle(tr("aar.battles")));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "aar-toggle-button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = `${tr("text.showBattleRecord")} (${battles.length})`;
    const list = document.createElement("div");
    list.className = "aar-battle-records";
    list.dataset.expanded = "false";
    list.hidden = true;
    if (!battles.length) {
      list.append(aarCard("", tr("text.noDeclared")));
    } else {
      for (const battle of battles) list.append(battleReportCard(battle));
    }
    toggle.addEventListener("click", () => {
      const expanded = list.hidden;
      list.hidden = !expanded;
      list.dataset.expanded = String(expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = `${expanded ? tr("text.hideBattleRecord") : tr("text.showBattleRecord")} (${battles.length})`;
    });
    el.aarBattles.append(toggle, list);
  }

  function battleReportCard(report) {
    const battle = battleById(report.id) || report;
    const title = `${hexLabel(report.defenderHexId)} · ${combatResultLabel(report.result || "Skipped")}`;
    const body = [
      `${tr("text.attackerHexes")}: ${(report.attackerHexIds || []).map(hexLabel).join(", ")}`,
      `${tr("text.odds")}: ${report.odds || "--"} · ${tr("text.die")}: ${report.roll || "--"}`,
      ...(battle.events || report.events || []).map((event) => event.text),
    ].filter(Boolean).join("\n");
    return aarCard(title, body);
  }

  function draw() {
    if (!app.state) return;
    applyLanguage();
    drawStatus();
    drawHexLayer();
    drawUnits();
    drawSelectedUnit();
    drawCombatPanel();
    drawOperationsBoard();
    drawLog();
    updateMenu();
    scheduleAlphaAssessment();
    scheduleAiTurn();
  }

  function drawAnimationFrame() {
    if (!app.state) return;
    drawStatus();
    drawHexLayer();
    drawUnits();
  }

  function drawStatus() {
    const turn = app.rules.turns[app.state.turn - 1];
    el.turnLabel.textContent = `${turnLabel(turn)} · ${sideLabel(activeSide())}`;
    el.phaseLabel.textContent = phaseLabel(phase().id);
    const onlineState = onlineClientState();
    const room = onlineState?.room;
    el.aiStatus.dataset.active = String(!isOnlineMatch() && app.ai.mode !== "hotseat" && (app.ai.running || isAiTurn() || hasAiControlledTask()));
    const aiControlStatus = isOnlineMatch() || app.ai.mode === "hotseat"
      ? ""
      : app.ai.waitingForHuman && isAiTurn()
        ? tr("ui.aiAwaitingInput")
        : app.ai.running || isAiTurn()
        ? tr("ui.aiThinking", { side: sideLabel(activeSide()) })
        : tr("ui.aiWaiting", { side: sideLabel(app.ai.humanSide), enemy: sideLabel(enemySide(app.ai.humanSide)) });
    if (PRODUCT_PROFILE.features.alphaRuntime && !isOnlineMatch() && app.ai.mode !== "hotseat") {
      const alphaRuntime = currentAlphaRuntimeMode();
      el.aiStatus.dataset.alphaRuntime = alphaRuntime.mode;
      el.aiStatus.title = alphaRuntime.reason
        ? app.aiAlphaBrowser?.alphaModelStatusReasonLabel?.(alphaRuntime.reason) || alphaRuntime.reason
        : "";
      el.aiStatus.textContent = `${aiControlStatus} · ${alphaRuntimeStatusText(alphaRuntime)}`;
    } else {
      delete el.aiStatus.dataset.alphaRuntime;
      el.aiStatus.title = "";
      el.aiStatus.textContent = aiControlStatus;
    }
    el.onlineGameStatus.hidden = !isOnlineMatch();
    el.onlineGameStatus.textContent = isOnlineMatch()
      ? `房间 ${room.roomCode} · 你是 ${sideLabel(onlineState.playerSide)} · revision ${room.revision} · ${isHumanInputBlocked() ? "等待对方或同步" : "轮到你行动"}`
      : "";
    el.boardBadge.textContent = boardBadgeText();
    el.finishDeclarationsButton.hidden = !(isCombatPhase() && app.state.combatMode === "declare");
    el.resolveBattleButton.hidden = !(isCombatPhase() && app.state.combatMode === "resolve");
    el.endPhaseButton.hidden = isCombatPhase() && app.state.combatMode === "declare";
    const pendingBattle = isCombatPhase() && app.state.combatMode === "resolve" ? currentBattle() : null;
    const blockInput = isOnlineMatch() ? isHumanInputBlocked() : app.ai.running || hasAiControlledTask();
    el.resolveBattleButton.disabled = Boolean(app.state.winner || blockInput || app.state.retreatTask || app.state.advanceTask || !pendingBattle);
    el.resolveBattleButton.textContent = pendingBattle ? tr("ui.resolveBattle") : tr("ui.done");
    el.finishDeclarationsButton.disabled = Boolean(app.state.winner || blockInput);
    el.endPhaseButton.disabled = Boolean(app.state.winner || blockInput);
    el.newGameButton.disabled = isOnlineMatch();
    el.saveButton.disabled = isOnlineMatch();
    el.loadButton.disabled = isOnlineMatch();
    if (app.state.winner) {
      el.winnerBanner.hidden = false;
      el.winnerBanner.textContent = `${sideLabel(app.state.winner.side)} · ${app.state.winner.reason}`;
    } else {
      el.winnerBanner.hidden = true;
      el.winnerBanner.textContent = "";
    }
  }

  function currentAlphaRuntimeMode() {
    return app.aiAlphaBrowser?.browserAlphaRuntimeMode?.({
      modelStatus: app.aiAlpha?.modelStatus || null,
      modelLoad: app.aiAlphaModelLoad,
    }) || {
      mode: "heuristic_fallback",
      reason: "model_missing",
      sourceHash: null,
    };
  }

  function alphaRuntimeStatusText(runtime) {
    if (runtime?.mode === "validated_preview_model") return tr("ui.alphaValidatedPreviewModel");
    if (runtime?.mode === "validated_model") return tr("ui.alphaValidatedModel");
    if (runtime?.mode === "load_failed") return tr("ui.alphaModelLoadFailed");
    return tr("ui.alphaHeuristicFallback");
  }

  function turnLabel(turn) {
    if (!turn) return `Turn ${app.state.turn}`;
    return app.lang === "en" ? turn.label.split(" / ")[0] : turn.label.split(" / ")[1] || turn.label;
  }

  function boardBadgeText() {
    if (app.state.retreatTask) {
      const unit = unitById(app.state.retreatTask.unitIds[app.state.retreatTask.index]);
      return unit ? tr("text.retreatPrompt", { unit: unitName(unit) }) : tr("text.retreatPrompt", { unit: "" });
    }
    if (app.state.advanceTask) return phaseLabel(phase().id);
    return phaseLabel(phase().id);
  }

  function drawBattleHighlights(ctx) {
    if (!isCombatPhase()) return;
    if (app.state.combatMode === "declare") {
      const focused = focusedBattle();
      const battles = focused ? [focused] : app.state.declaredCombats;
      for (const battle of battles) {
        for (const attackerId of battle.attackerIds) drawHex(ctx, hexById(unitById(attackerId)?.hexId), HIGHLIGHT.declaredAttack, 3);
        drawHex(ctx, hexById(unitById(battle.defenderId)?.hexId), HIGHLIGHT.declaredDefender, 3);
      }
      return;
    }
    const battle = focusedBattle() || currentBattle();
    if (!battle) return;
    for (const attackerId of battle.attackerIds) drawHex(ctx, hexById(unitById(attackerId)?.hexId), HIGHLIGHT.currentAttack, 5);
    drawHex(ctx, hexById(unitById(battle.defenderId)?.hexId || battle.defenderHexId), HIGHLIGHT.currentDefender, 5);
  }

  function drawAlphaRecommendationHighlights(ctx) {
    const action = currentAlphaBestAction();
    if (!action?.type) return;
    const envAction = app.core?.ENV_ACTION || {};
    if (action.type === envAction.MOVE_UNIT || action.type === envAction.RETREAT_UNIT) {
      const unit = unitById(action.unitId);
      drawHex(ctx, hexById(action.fromHexId || unit?.hexId), HIGHLIGHT.alphaSource, 3);
      drawHex(ctx, hexById(action.toHexId), HIGHLIGHT.alphaTarget, 6);
      return;
    }
    if (action.type === envAction.DECLARE_COMBAT) {
      for (const attackerId of action.attackerIds || []) drawHex(ctx, hexById(unitById(attackerId)?.hexId), HIGHLIGHT.alphaSource, 3);
      drawHex(ctx, hexById(unitById(action.defenderId)?.hexId), HIGHLIGHT.alphaTarget, 6);
      return;
    }
    if (action.type === envAction.ADVANCE_UNIT) {
      const unit = unitById(action.unitId);
      drawHex(ctx, hexById(unit?.hexId), HIGHLIGHT.alphaSource, 3);
      drawHex(ctx, hexById(action.targetHexId), HIGHLIGHT.alphaTarget, 6);
      return;
    }
    if (action.type === envAction.RESOLVE_COMBAT) {
      const battle = battleById(action.battleId) || currentBattle();
      if (!battle) return;
      for (const attackerId of battle.attackerIds || []) drawHex(ctx, hexById(unitById(attackerId)?.hexId), HIGHLIGHT.alphaSource, 3);
      drawHex(ctx, hexById(unitById(battle.defenderId)?.hexId || battle.defenderHexId), HIGHLIGHT.alphaTarget, 6);
    }
  }

  function drawHexLayer() {
    const ctx = el.hexLayer.getContext("2d");
    ctx.clearRect(0, 0, el.hexLayer.width, el.hexLayer.height);
    drawBattleHighlights(ctx);
    drawAlphaRecommendationHighlights(ctx);
    if (app.state.selectedUnitId) drawHex(ctx, hexById(unitById(app.state.selectedUnitId)?.hexId), HIGHLIGHT.selected, 5);
    for (const hexId of app.reachable.keys()) drawHex(ctx, hexById(hexId), HIGHLIGHT.reachable, 3);
    if (app.state.selectedDefenderId) drawHex(ctx, hexById(unitById(app.state.selectedDefenderId)?.hexId), HIGHLIGHT.defender, 5);
    for (const attackerId of app.state.selectedAttackers) drawHex(ctx, hexById(unitById(attackerId)?.hexId), HIGHLIGHT.attack, 4);
    for (const hexId of app.legalRetreatSteps) drawHex(ctx, hexById(hexId), HIGHLIGHT.retreat, 4);
    if (app.state.advanceTask) drawHex(ctx, hexById(app.state.advanceTask.targetHexId), HIGHLIGHT.attack, 5);
  }

  function drawHex(ctx, hex, color, lineWidth) {
    if (!hex) return;
    const radius = 49;
    const points = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.PI / 180 * (-90 + 60 * i);
      points.push({ x: hex.center.x + Math.cos(angle) * radius, y: hex.center.y + Math.sin(angle) * radius });
    }
    ctx.save();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = color.replace(/0\.\d+\)/, "0.95)");
    ctx.lineWidth = lineWidth;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function unitBattleRole(unitId) {
    if (app.state.combatMode === "declare") {
      const focused = focusedBattle();
      const battles = focused ? [focused] : app.state.declaredCombats;
      for (const battle of battles) {
        if (battle.defenderId === unitId) return "declared-defender";
        if (battle.attackerIds.includes(unitId)) return "declared-attacker";
      }
    } else {
      const activeBattle = focusedBattle() || currentBattle();
      if (activeBattle?.defenderId === unitId) return "current-defender";
      if (activeBattle?.attackerIds.includes(unitId)) return "current-attacker";
    }
    return "";
  }

  function drawUnits() {
    el.unitLayer.replaceChildren();
    for (const unit of liveUnits()) {
      const hex = hexById(unit.hexId);
      if (!hex) continue;
      const node = document.createElement("button");
      node.type = "button";
      node.className = "unit";
      node.dataset.side = unit.side;
      node.dataset.selected = String(unit.id === app.state.selectedUnitId || unit.id === app.state.selectedDefenderId || app.state.selectedAttackers.includes(unit.id));
      node.dataset.used = String(app.state.movedUnits.includes(unit.id) || app.state.usedAttackers.includes(unit.id) || app.state.usedDefenders.includes(unit.id));
      node.dataset.battleRole = unitBattleRole(unit.id);
      node.style.left = `${hex.center.x}px`;
      node.style.top = `${hex.center.y}px`;
      node.title = `${unitName(unit)} ${unit.combat}-${unit.movement}`;
      node.addEventListener("click", (event) => onUnitClick(event, unit.id));
      const image = document.createElement("img");
      image.src = unit.image;
      image.alt = unitName(unit);
      node.append(image);
      if (unit.disrupted) {
        const disrupted = document.createElement("span");
        disrupted.className = "disrupted";
        disrupted.textContent = "D";
        node.append(disrupted);
      }
      el.unitLayer.append(node);
    }
  }

  function drawSelectedUnit() {
    const unit = unitById(app.state.selectedUnitId) || unitById(app.state.selectedDefenderId);
    if (!unit) {
      el.selectedUnit.className = "selected-unit empty";
      el.selectedUnit.textContent = tr("ui.noSelection");
      return;
    }
    el.selectedUnit.className = "selected-unit";
    const wrap = document.createElement("div");
    wrap.className = "unit-card";
    const image = document.createElement("img");
    image.src = unit.image;
    image.alt = unitName(unit);
    const meta = document.createElement("div");
    meta.className = "unit-meta";
    const title = document.createElement("strong");
    title.textContent = unitName(unit);
    const stats = document.createElement("span");
    stats.textContent = `${sideLabel(unit.side)} · ${nationalityLabel(unit.nationality)} · ${unit.combat}-${unit.movement}`;
    const state = document.createElement("span");
    state.textContent = unit.disrupted ? tr("text.disrupted") : tr("text.ready");
    meta.append(title, stats, state);
    wrap.append(image, meta);
    if (canUndoLastMove(unit)) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "undo-move-button";
      undo.textContent = tr("text.undoMove");
      undo.addEventListener("click", undoLastMove);
      wrap.append(undo);
    }
    el.selectedUnit.replaceChildren(wrap);
  }

  function drawCombatPanel() {
    el.combatComposer.replaceChildren();
    if (!isCombatPhase()) {
      el.combatComposer.textContent = "--";
      return;
    }
    if (app.state.combatMode === "declare") {
      el.combatComposer.textContent = tr("text.declareInOperations");
      return;
    }
    const battle = currentBattle();
    if (!battle) {
      el.combatComposer.textContent = app.state.declaredCombats.length ? tr("text.allDone") : tr("text.noBattle");
      return;
    }
    const card = document.createElement("div");
    card.className = "composer-card";
    const title = document.createElement("strong");
    title.textContent = `${tr("text.currentBattle")} · ${hexLabel(battle.defenderHexId)}`;
    const detail = document.createElement("span");
    detail.textContent = compactOddsText(battle.oddsAtResolution || battle.oddsAtDeclaration || "--");
    card.append(title, detail);
    el.combatComposer.append(card);
  }

  function drawCombatComposer() {
    const defender = unitById(app.state.selectedDefenderId);
    const attackers = app.state.selectedAttackers.map(unitById).filter(Boolean);
    const card = document.createElement("div");
    card.className = "composer-card";
    card.append(line(`${tr("text.selectedDefender")}: ${defender ? `${unitName(defender)} · ${hexLabel(defender.hexId)}` : "--"}`));
    const row = document.createElement("div");
    row.className = "pill-row";
    if (attackers.length) attackers.forEach((unit) => row.append(pill(`${unitName(unit)} · ${hexLabel(unit.hexId)}`)));
    else row.append(pill("--"));
    const odds = document.createElement("div");
    odds.className = "odds-preview";
    odds.textContent = previewOddsText(attackers, defender);
    const actions = document.createElement("div");
    actions.className = "composer-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = tr("text.addBattle");
    add.disabled = !defender || !attackers.length;
    add.addEventListener("click", declareBattle);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = tr("text.clear");
    clear.addEventListener("click", () => {
      app.state.selectedDefenderId = null;
      app.state.selectedAttackers = [];
      draw();
    });
    actions.append(add, clear);
    card.append(line(`${tr("text.selectedAttackers")}:`), row, odds, actions);
    el.combatComposer.append(card);
  }

  function declarationFocusCard() {
    const defender = unitById(app.state.selectedDefenderId);
    const attackers = app.state.selectedAttackers.map(unitById).filter(Boolean);
    const card = document.createElement("div");
    card.className = "operation-card declaration-focus";
    if (defender) card.dataset.severity = "good";

    const title = document.createElement("strong");
    title.textContent = tr("text.currentDeclaration");
    card.append(title);
    card.append(line(`${tr("text.defenderOnly")}: ${defender ? hexLabel(defender.hexId) : "--"}`));

    const row = document.createElement("div");
    row.className = "pill-row";
    if (attackers.length) attackers.forEach((unit) => row.append(pill(hexLabel(unit.hexId))));
    else row.append(pill("--"));

    const odds = document.createElement("div");
    odds.className = "odds-preview";
    odds.textContent = previewOddsText(attackers, defender);

    const actions = document.createElement("div");
    actions.className = "composer-actions";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = tr("text.addBattle");
    add.disabled = !defender || !attackers.length;
    add.addEventListener("click", declareBattle);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = tr("text.clear");
    clear.addEventListener("click", () => {
      app.state.selectedDefenderId = null;
      app.state.selectedAttackers = [];
      draw();
    });
    actions.append(add, clear);

    card.append(line(`${tr("text.selectedAttackers")}:`), row, odds, actions);
    if (!defender) card.append(line(tr("text.chooseDefender")));
    return card;
  }

  function drawOperationsBoard() {
    el.operationsFocus.replaceChildren();
    el.battleList.replaceChildren();
    if (isCombatPhase() && app.state.combatMode === "resolve" && (app.state.retreatTask || app.state.advanceTask)) {
      appendCombatResolutionFocus();
      appendCombatListForCurrentMode();
      appendAlphaAssessmentCard();
      appendTrainingRecordCard();
      return;
    }
    if (isCombatPhase() && app.state.combatMode === "declare") {
      el.operationsFocus.append(declarationFocusCard());
      appendBattleListTitle(tr("text.declaredBattles"));
      if (!app.state.declaredCombats.length) {
        el.battleList.append(operationCard("", tr("text.noDeclared"), ""));
      } else {
        app.state.declaredCombats.forEach((battle, index) => el.battleList.append(declaredBattleRow(battle, index)));
      }
      appendAlphaAssessmentCard();
      appendTrainingRecordCard();
      return;
    }
    if (app.state.lastCombatResult) {
      appendCombatResolutionFocus();
    } else if (isCombatPhase() && app.state.combatMode === "resolve") {
      const battle = currentBattle();
      const details = battle
        ? [
          `${tr("text.defenderHex")}: ${hexLabel(battle.defenderHexId)}`,
          `${tr("text.odds")}: ${battle.oddsShort || compactOddsText(battle.oddsAtDeclaration)}`,
        ].join("\n")
        : tr("text.allDone");
      el.operationsFocus.append(operationCard(tr("text.combatSummary"), details, battle ? "" : "good"));
    } else {
      el.operationsFocus.append(operationCard(tr("text.phaseOrders"), phaseLabel(phase().id), ""));
      if (isMovementPhase() && canUndoLastMove(unitById(app.state.lastMove?.unitId))) {
        el.operationsFocus.append(lastMoveUndoCard());
      }
    }
    if (isCombatPhase() && app.state.combatMode === "declare") {
      if (!app.state.declaredCombats.length) {
        el.battleList.append(operationCard("", tr("text.noDeclared"), ""));
      } else {
        app.state.declaredCombats.forEach((battle, index) => el.battleList.append(declaredBattleRow(battle, index)));
      }
    } else if (isCombatPhase()) {
      appendBattleListTitle(tr("text.declaredBattles"));
      app.state.declaredCombats.forEach((battle) => el.battleList.append(resolutionBattleRow(battle)));
    }
    appendAlphaAssessmentCard();
    appendTrainingRecordCard();
  }

  function appendAlphaAssessmentCard() {
    if (app.ai.mode === "hotseat") return;
    const summary = app.aiAlpha?.lastSummary;
    const snapshot = app.aiAlphaGameAdapter?.lastSnapshot;
    const bestAction = currentAlphaBestAction();
    if (!summary || !bestAction) {
      if (appendAlphaAdapterStatusCard(snapshot, summary)) return;
      appendAlphaModelStatusCard();
      return;
    }
    const details = [
      `${sideLabel(summary.side)} ${phaseLabel(summary.phaseId || phase().id)} value ${formatSignedNumber(summary.rootValue)}`,
      `Best now: ${alphaActionLabel(bestAction)}`,
      alphaAdapterStatusLine(snapshot),
      alphaAdapterSelectionLine(snapshot),
      alphaRecommendationLine(summary.recommendation),
      alphaCandidateLine(summary.candidateLines),
      `Search: ${summary.search.iterations} iters / ${summary.search.rootChildren} choices${summary.cache?.hit ? " / cached" : ""}`,
      alphaProgressLine(summary.progress),
      alphaModelEvidenceLine(summary.model),
      alphaExplanationLine(summary.explanation),
      alphaFeatureLine(summary.features),
    ].filter(Boolean).join("\n");
    const card = operationCard("Alpha Analysis", details, alphaAssessmentSeverity(summary.rootValue));
    card.classList.add("alpha-assessment-card");
    el.operationsFocus.append(card);
  }

  function appendAlphaAdapterStatusCard(snapshot, summary = app.aiAlpha?.lastSummary) {
    if (!snapshot || snapshot.model?.ok === false) return false;
    const status = snapshot.status || "idle";
    if (status === "ready" && snapshot.action?.canApply) return false;
    const details = [
      alphaAdapterStatusLine(snapshot) || `Status: ${alphaAdapterStatusLabel(status)}`,
      snapshot.reason ? `Reason: ${alphaModelStatusLabel(snapshot.reason)}` : "",
      summary?.stateHash ? `Last: ${sideLabel(summary.side)} ${phaseLabel(summary.phaseId || phase().id)} value ${formatSignedNumber(summary.rootValue)}` : "",
      snapshot.scheduler?.inFlight ? "Search: in flight" : "",
      snapshot.scheduler?.scheduled ? "Search: queued" : "",
      snapshot.scheduler?.discardedResults ? `Discarded stale: ${snapshot.scheduler.discardedResults}` : "",
    ].filter(Boolean).join("\n");
    const card = operationCard("Alpha Analysis", details, status === "stale" ? "danger" : "");
    card.classList.add("alpha-assessment-card");
    el.operationsFocus.append(card);
    return true;
  }

  function appendAlphaModelStatusCard() {
    const status = app.aiAlpha?.modelStatus;
    if (!status || status.ok) return;
    const details = [
      "No trusted Alpha model loaded",
      `Status: ${alphaModelStatusLabel(status.reason)}`,
      "Scripted AI fallback remains active",
    ].join("\n");
    const card = operationCard("Alpha Analysis", details, "");
    card.classList.add("alpha-assessment-card");
    el.operationsFocus.append(card);
  }

  function alphaModelStatusLabel(reason) {
    return app.aiAlphaBrowser?.alphaModelStatusReasonLabel?.(reason) || String(reason || "unavailable");
  }

  function alphaAdapterStatusLine(snapshot) {
    if (!snapshot?.status) return "";
    if (snapshot.status === "ready" && snapshot.action?.canApply) return "";
    return `Status: ${alphaAdapterStatusLabel(snapshot.status)}`;
  }

  function alphaAdapterStatusLabel(status) {
    const labels = {
      pending: "analysis pending",
      refreshing: "refreshing",
      stale: "stale result",
      idle: "idle",
      analysis_only: "analysis only",
      model_untrusted: "model untrusted",
      ready: "ready",
    };
    return labels[status] || String(status || "unavailable");
  }

  function alphaAdapterSelectionLine(snapshot) {
    if (!isAlphaAdapterSnapshotCurrent(snapshot) || !snapshot?.legalSelection?.selectedSource) return "";
    const source = snapshot.legalSelection.selectedSource;
    if (source === "direct") return "";
    const skipped = Number(snapshot.legalSelection.illegalCandidateCount || 0);
    return `Selected legal candidate: ${source}${skipped ? ` / skipped ${skipped}` : ""}`;
  }

  function alphaModelEvidenceLine(model) {
    if (!model) return "";
    const items = [];
    const source = alphaModelSourceLine(model);
    if (source) items.push(source);
    if (model.trainingSamples !== null && model.trainingSamples !== undefined) items.push(`train ${model.trainingSamples}`);
    if (model.reanalysisSamples !== null && model.reanalysisSamples !== undefined) items.push(`reanalyzed ${model.reanalysisSamples}`);
    if (model.stateSnapshots !== null && model.stateSnapshots !== undefined) items.push(`snapshots ${model.stateSnapshots}`);
    if (model.validationSamples !== null && model.validationSamples !== undefined) {
      const metrics = [];
      if (model.validationValueMse !== null && model.validationValueMse !== undefined) metrics.push(`v ${Number(model.validationValueMse).toFixed(3)}`);
      if (model.validationPolicyCrossEntropy !== null && model.validationPolicyCrossEntropy !== undefined) metrics.push(`p ${Number(model.validationPolicyCrossEntropy).toFixed(3)}`);
      const group = model.validationGroupBy && model.validationGroupBy !== "sample" ? ` by ${model.validationGroupBy}` : "";
      items.push(`holdout ${model.validationSamples}${group}${metrics.length ? ` (${metrics.join(", ")})` : ""}`);
    }
    if (model.expectedEnvironmentFingerprint) {
      items.push(`env ${model.environmentMatches === true ? "ok" : model.environmentMatches === false ? "mismatch" : "unknown"}`);
    }
    if (model.expectedFeatureContractFingerprint) {
      items.push(`features ${model.featureContractMatches === true ? "ok" : model.featureContractMatches === false ? "mismatch" : "unknown"}`);
    }
    if (model.analyzedActions !== null && model.analyzedActions !== undefined) items.push(`analyzed ${model.analyzedActions}`);
    const selectedShare = alphaPercent(model.selectedActionShare);
    const fallbackRate = alphaPercent(alphaFallbackRate(model));
    if (selectedShare || fallbackRate) items.push(`search ${selectedShare ? `selected ${selectedShare}` : ""}${selectedShare && fallbackRate ? " / " : ""}${fallbackRate ? `fallback ${fallbackRate}` : ""}`);
    const confidence = alphaPercent(model.averageRecommendationConfidence);
    const uncertainty = alphaPercent(model.averageRecommendationUncertainty);
    if (confidence || uncertainty) items.push(`decisions ${confidence || "--"} conf${uncertainty ? ` / ${uncertainty} uncertain` : ""}`);
    const minConfidence = alphaPercent(model.minDecisionAverageRecommendationConfidence);
    const maxUncertainty = alphaPercent(model.maxDecisionAverageRecommendationUncertainty);
    const minSelected = alphaPercent(model.minDecisionSelectedActionShare);
    const maxFallback = alphaPercent(model.maxDecisionFallbackRate);
    if (minConfidence || maxUncertainty || minSelected || maxFallback) {
      const gates = [];
      if (minConfidence) gates.push(`conf>=${minConfidence}`);
      if (maxUncertainty) gates.push(`unc<=${maxUncertainty}`);
      if (minSelected) gates.push(`sel>=${minSelected}`);
      if (maxFallback) gates.push(`fb<=${maxFallback}`);
      items.push(`gate ${gates.join(" ")}`);
    }
    if (model.runtimeTarget) items.push(`runtime ${model.runtimeInstallApproved ? "approved" : "unapproved"}`);
    return items.length ? `Model: ${items.join(" / ")}` : "";
  }

  function alphaFallbackRate(model) {
    const decisions = Number(model?.decisionCount || 0);
    if (!(decisions > 0)) return null;
    return Number(model?.fallbackActions || 0) / decisions;
  }

  function alphaModelSourceLine(model) {
    if (!model) return "";
    const bits = [];
    if (model.sourceSchema) {
      const sourceKind = String(model.sourceSchema).includes("ladder") ? "ladder" : String(model.sourceSchema).includes("cycle") ? "cycle" : "model";
      bits.push(sourceKind);
    }
    if (model.activeGeneration !== null && model.activeGeneration !== undefined) bits.push(`gen ${model.activeGeneration}`);
    if (model.sourceHash) bits.push(shortAlphaHash(model.sourceHash));
    const evalBits = [];
    if (model.evaluationSuiteGames !== null && model.evaluationSuiteGames !== undefined) evalBits.push(`${model.evaluationSuiteGames}g`);
    if (model.evaluationSuiteSides !== null && model.evaluationSuiteSides !== undefined) evalBits.push(`${model.evaluationSuiteSides}s`);
    if (model.evaluationSuiteChallengePositions !== null && model.evaluationSuiteChallengePositions !== undefined) evalBits.push(`c${model.evaluationSuiteChallengePositions}`);
    if (evalBits.length) bits.push(`eval ${evalBits.join("/")}`);
    return bits.length ? `source ${bits.join(" ")}` : "";
  }

  function alphaPercent(value) {
    const next = Number(value);
    return Number.isFinite(next) ? `${Math.round(next * 100)}%` : "";
  }

  function shortAlphaHash(value) {
    const text = String(value || "");
    return text.startsWith("sha256:") ? text.slice(7, 19) : shortenAlphaLabel(text, 12);
  }

  function alphaCandidateLine(candidateLines = []) {
    const items = candidateLines.slice(0, 2).map((line, index) => {
      const share = `${Math.round(Number(line.visitShare || 0) * 100)}%`;
      const label = shortenAlphaLabel(alphaActionLabel(line.action), 44);
      return `${index + 1}. ${label} ${share} q ${formatSignedNumber(line.q)}`;
    });
    return items.length ? `Lines: ${items.join(" | ")}` : "";
  }

  function alphaRecommendationLine(recommendation) {
    if (!recommendation) return "";
    const confidence = Math.round(Number(recommendation.confidence || 0) * 100);
    const margin = Math.round(Number(recommendation.visitMargin || 0) * 100);
    const qMargin = recommendation.qMargin === null || recommendation.qMargin === undefined
      ? ""
      : ` / q ${formatSignedNumber(recommendation.qMargin)}`;
    return `Confidence: ${alphaRecommendationLabel(recommendation.label)} ${confidence}% / margin ${margin}pp${qMargin}`;
  }

  function alphaRecommendationLabel(label) {
    const labels = {
      forced: "forced",
      strong: "strong",
      stable: "stable",
      contested: "contested",
    };
    return labels[label] || "unknown";
  }

  function alphaProgressLine(progress = []) {
    const items = progress.slice(-3).map((snapshot) => {
      const label = shortenAlphaLabel(alphaActionLabel(snapshot.bestAction), 28);
      return `${snapshot.iterations}i ${label}`;
    });
    return items.length > 1 ? `Progress: ${items.join(" -> ")}` : "";
  }

  function shortenAlphaLabel(value, limit) {
    const text = String(value || "--");
    const max = Math.max(4, Number(limit || 44));
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function alphaAssessmentSeverity(value) {
    const next = Number(value || 0);
    if (next >= 0.35) return "good";
    if (next <= -0.35) return "danger";
    return "";
  }

  function alphaFeatureLine(features = []) {
    const items = features.slice(0, 3).map((entry) => `${alphaFeatureLabel(entry.key)} ${formatSignedNumber(entry.value)}`);
    return items.length ? `Signals: ${items.join(", ")}` : "";
  }

  function alphaExplanationLine(explanation) {
    const valueItems = alphaContributionItems(explanation?.value?.entries, 2);
    const policyItems = alphaContributionItems(explanation?.policy?.entries, 2);
    const items = [];
    if (valueItems.length) items.push(`value ${valueItems.join(", ")}`);
    if (policyItems.length) items.push(`policy ${policyItems.join(", ")}`);
    return items.length ? `Why: ${items.join(" / ")}` : "";
  }

  function alphaContributionItems(entries = [], limit = 2) {
    return entries.slice(0, limit).map((entry) => {
      const sign = Number(entry.contribution || 0) >= 0 ? "+" : "";
      return `${alphaFeatureLabel(entry.key)} ${sign}${Number(entry.contribution || 0).toFixed(2)}`;
    });
  }

  function alphaFeatureLabel(key) {
    const labels = {
      materialBalance: "material",
      unitBalance: "units",
      axisObjectiveDistance: "objective dist",
      axisObjectiveProgress: "objective progress",
      axisObjectivePressure: "objective pressure",
      alliedExitDistance: "exit dist",
      alliedExitPressure: "exit pressure",
      friendlyCohesion: "friendly cohesion",
      enemyCohesion: "enemy cohesion",
      friendlyThreats: "friendly threats",
      enemyThreats: "enemy threats",
      axisObjectiveHeld: "objective held",
      move: "move",
      declareCombat: "combat",
      endPhase: "end phase",
      routeRemaining: "remaining mp",
      routeSpent: "spent mp",
      attackerCount: "attackers",
      axisObjectiveDestination: "objective hex",
      alliedExitDestination: "exit hex",
      moveWithAxisObjectivePressure: "move pressure",
      moveWithAxisObjectiveProgress: "move progress",
      moveWithAxisObjectiveLocalAdvantage: "move local force",
      combatWithFriendlyThreats: "combat threat",
      combatWithEnemyThreats: "enemy threat",
      combatWithAxisObjectiveLocalAdvantage: "combat local force",
      advanceWithAxisObjectivePressure: "advance pressure",
      advanceWithAxisObjectiveLocalAdvantage: "advance local force",
      endPhaseWithEnemyThreats: "end under threat",
    };
    return labels[key] || String(key || "--");
  }

  function alphaActionLabel(action) {
    if (!action?.type) return "--";
    if (action.type === app.core?.ENV_ACTION?.MOVE_UNIT) {
      const unit = unitById(action.unitId);
      return `${unitName(unit)} ${hexLabel(action.fromHexId || unit?.hexId)} -> ${hexLabel(action.toHexId)}`;
    }
    if (action.type === app.core?.ENV_ACTION?.DECLARE_COMBAT) {
      return `${tr("ui.combat")} ${hexLabel(unitById(action.defenderId)?.hexId)} (${(action.attackerIds || []).length})`;
    }
    if (action.type === app.core?.ENV_ACTION?.END_PHASE) return tr("ui.endPhase");
    if (action.type === app.core?.ENV_ACTION?.RESOLVE_COMBAT) return `${tr("ui.resolveBattle")} ${action.dieRoll || "--"}`;
    return String(action.type);
  }

  function formatSignedNumber(value) {
    const next = Number(value || 0);
    const formatted = Math.abs(next) >= 10 ? next.toFixed(0) : next.toFixed(2);
    return next > 0 ? `+${formatted}` : formatted;
  }

  function appendTrainingRecordCard() {
    if (!app.state) return;
    const count = app.training.entries.length;
    const eventCount = app.training.events.length;
    const card = document.createElement("details");
    card.className = "operation-card training-record-card";
    if (count || eventCount) card.dataset.severity = "good";

    const summary = document.createElement("summary");
    summary.textContent = tr("ui.trainingData");
    card.append(summary);

    const content = document.createElement("div");
    content.className = "training-record-content";
    content.append(
      line(tr("ui.preferenceSamples", { count })),
      line(tr("ui.replayEvents", { count: eventCount })),
    );
    const actions = document.createElement("div");
    actions.className = "training-actions";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = tr("ui.exportJson");
    exportButton.disabled = count <= 0 && eventCount <= 0;
    exportButton.addEventListener("click", exportTrainingEntries);
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = tr("ui.clearTrainingData");
    clearButton.disabled = count <= 0 && eventCount <= 0;
    clearButton.addEventListener("click", clearTrainingEntries);
    actions.append(exportButton, clearButton);
    content.append(actions);
    card.append(content);
    el.operationsFocus.append(card);
  }

  function appendCombatResolutionFocus() {
    el.operationsFocus.append(combatResolutionFocusCard());
    const instruction = pendingCombatInstructionCard();
    if (instruction) el.operationsFocus.append(instruction);
  }

  function combatResolutionFocusCard() {
    const result = app.state.lastCombatResult;
    if (result) {
      const details = [
        `${tr("text.defenderHex")}: ${result.defenderHex}`,
        `${tr("text.odds")}: ${result.odds} · ${tr("text.die")}: ${result.roll}`,
        `${tr("text.result")}: ${combatResultLabel(result.result)}`,
        ...(result.events || []).map((event) => event.text),
      ].join("\n");
      const card = operationCard(tr("text.combatSummary"), details, result.events?.some((event) => event.type === "eliminated") ? "danger" : "good");
      card.classList.add("combat-resolution-focus");
      return card;
    }
    const battle = currentBattle();
    const details = battle
      ? [
        `${tr("text.defenderHex")}: ${hexLabel(battle.defenderHexId)}`,
        `${tr("text.odds")}: ${battle.oddsShort || compactOddsText(battle.oddsAtDeclaration)}`,
      ].join("\n")
      : tr("text.allDone");
    const card = operationCard(tr("text.combatSummary"), details, battle ? "" : "good");
    card.classList.add("combat-resolution-focus");
    return card;
  }

  function pendingCombatInstructionCard() {
    if (app.state.retreatTask) {
      const unit = unitById(app.state.retreatTask.unitIds[app.state.retreatTask.index]);
      const card = operationCard(tr("text.retreatInstruction"), tr("text.retreatPrompt", { unit: unitName(unit) }), "danger");
      card.classList.add("operation-instruction-card");
      return card;
    }
    if (app.state.advanceTask) {
      const card = operationCard(tr("text.advanceInstruction"), tr("text.advancePrompt", { hex: hexLabel(app.state.advanceTask.targetHexId) }), "good");
      card.classList.add("operation-instruction-card");
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "inline-skip-button";
      skip.textContent = tr("text.skip");
      skip.addEventListener("click", () => advanceUnit("skip"));
      card.append(skip);
      return card;
    }
    return null;
  }

  function lastMoveUndoCard() {
    const move = app.state.lastMove;
    const unit = unitById(move?.unitId);
    const card = operationCard(
      tr("text.undoMove"),
      unit ? `${unitName(unit)}: ${hexLabel(move.toHexId)} -> ${hexLabel(move.fromHexId)}` : "--",
      "good",
    );
    card.classList.add("operation-instruction-card");
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "inline-skip-button";
    undo.textContent = tr("text.undoMove");
    undo.addEventListener("click", undoLastMove);
    card.append(undo);
    return card;
  }

  function appendCombatListForCurrentMode() {
    if (!isCombatPhase()) return;
    appendBattleListTitle(tr("text.declaredBattles"));
    if (app.state.combatMode === "declare") {
      if (!app.state.declaredCombats.length) el.battleList.append(operationCard("", tr("text.noDeclared"), ""));
      else app.state.declaredCombats.forEach((battle, index) => el.battleList.append(declaredBattleRow(battle, index)));
      return;
    }
    app.state.declaredCombats.forEach((battle) => el.battleList.append(resolutionBattleRow(battle)));
  }

  function appendBattleListTitle(text) {
    const title = document.createElement("div");
    title.className = "battle-list-title";
    title.textContent = text;
    el.battleList.append(title);
  }

  function operationCard(title, body, severity = "") {
    const card = document.createElement("div");
    card.className = "operation-card";
    if (severity) card.dataset.severity = severity;
    if (title) {
      const strong = document.createElement("strong");
      strong.textContent = title;
      card.append(strong);
    }
    String(body || "").split("\n").forEach((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      if (text.includes("歼灭") || text.includes("eliminated")) p.className = "eliminated-line";
      card.append(p);
    });
    return card;
  }

  function declaredBattleRow(battle, index) {
    const row = document.createElement("div");
    row.className = "battle-row";
    row.dataset.declaration = "true";
    row.dataset.focused = String(app.focusedBattleId === battle.id);
    row.tabIndex = 0;
    row.addEventListener("click", () => toggleFocusedBattle(battle.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleFocusedBattle(battle.id);
      }
    });
    const title = document.createElement("strong");
    title.textContent = `#${index + 1} · ${hexLabel(battle.defenderHexId)}`;
    const meta = document.createElement("div");
    meta.className = "operation-meta";
    [battle.oddsShort || compactOddsText(battle.oddsAtDeclaration), phaseLabel(battle.phaseId)].forEach((text) => {
      const item = document.createElement("span");
      item.textContent = text;
      meta.append(item);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "battle-cancel-button";
    cancel.textContent = "X";
    cancel.title = tr("text.cancel");
    cancel.hidden = isOnlineMatch();
    cancel.disabled = isOnlineMatch();
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      cancelDeclaredBattle(battle.id);
    });
    row.append(title, meta, cancel);
    return row;
  }

  function resolutionBattleRow(battle) {
    const row = document.createElement("div");
    row.className = "battle-row";
    row.dataset.resolved = String(battle.resolved);
    row.dataset.current = String(currentBattle()?.id === battle.id);
    row.dataset.focused = String(app.focusedBattleId === battle.id);
    row.tabIndex = 0;
    row.addEventListener("click", () => toggleFocusedBattle(battle.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleFocusedBattle(battle.id);
      }
    });
    const title = document.createElement("strong");
    title.textContent = `${hexLabel(battle.defenderHexId)} · ${battle.resultCode ? combatResultLabel(battle.resultCode) : compactOddsText(battle.oddsShort || battle.oddsAtDeclaration)}`;
    const detail = document.createElement("small");
    detail.textContent = battle.roll ? `${tr("text.die")}: ${battle.roll}` : phaseLabel(battle.phaseId);
    row.append(title, detail);
    return row;
  }

  function compactOddsText(text) {
    return String(text || "--").split(";")[0];
  }

  function formatBattleTitle(battle) {
    return `${battle.attackerHexIds.map(hexLabel).join(", ")} -> ${hexLabel(battle.defenderHexId)}`;
  }

  function pill(text) {
    const node = document.createElement("span");
    node.className = "pill";
    node.textContent = text;
    return node;
  }

  function line(text) {
    const node = document.createElement("div");
    node.textContent = text;
    return node;
  }

  function drawLog() {
    el.logBlock.dataset.expanded = String(app.logExpanded);
    el.logToggleButton.textContent = app.logExpanded ? tr("ui.closeLog") : tr("ui.openLog");
    el.logList.replaceChildren();
    const messages = app.logExpanded ? app.state.log.slice(-80) : app.state.log.slice(-1);
    for (const message of messages) {
      const item = document.createElement("p");
      item.textContent = message;
      el.logList.append(item);
    }
    if (app.logExpanded) el.logList.scrollTop = el.logList.scrollHeight;
  }

  init();
})();
