// Typed shapes of the JSON configs (源文档第 11 章 + game.json for global tunables).

export type Vec3Tuple = [number, number, number];
export type Vec2Tuple = [number, number];

export interface CharacterDef {
  id: string;
  displayName: string;
  role: 'gunner' | 'economy';
  tagline: string;
  maxHealth: number;
  damageMultiplier: number;
  moveSpeedMultiplier: number;
  passiveSunPerSecond: number;
  startingSun: number;
  startingItems: Record<string, number>;
  startingReserveAmmo: number;
  weapon: string | null;
  canBuyAmmo: boolean;
  availableSeeds: string[];
  blockedSeeds: string[];
  availablePotions: string[];
}

export interface GunDef {
  id: string;
  displayName: string;
  damage: number;
  headshotMultiplier: number;
  limbMultiplier: number;
  rpm: number;
  magazineSize: number;
  reserveAmmoMax: number;
  reloadTime: number;
  range: number;
  falloffMultiplier: number;
  baseSpreadDeg: number;
  maxSpreadDeg: number;
  recoilVerticalDeg: number;
  recoilHorizontalDeg: number;
  adsFov: number;
  adsMoveMultiplier: number;
  hipFov: number;
  spreadPerShotDeg: number;
  spreadMoveAddDeg: number;
  spreadAirAddDeg: number;
  adsSpreadMultiplier: number;
  spreadRecoverTime: number;
  recoilRecoverTime: number;
}

export interface AmmoPackDef {
  id: string;
  displayName: string;
  price: number;
  rounds: number;
  refillsReserveDirectly: boolean;
}

export interface WeaponsConfig {
  pea_gun: GunDef;
  ammo_pack: AmmoPackDef;
  [key: string]: GunDef | AmmoPackDef;
}

export interface ZombieTargetingDef {
  playerAlwaysFirst: boolean;
  breakWallWhenBlocked: boolean;
  plantShareKillRange: number;
  plantKillWhenPlayerUnreachableRange: number;
  sunflowerShareKillRange: number;
  deaggroWhenPlayerLost: { distance: number; seconds: number };
  reevaluateInterval: number;
}

export interface ZombieDef {
  id: string;
  displayName: string;
  health: number;
  wanderSpeed: number;
  chaseSpeed: number;
  attackDamage: number;
  attackDamageVsPlant: Record<string, number>;
  attackInterval: number;
  attackRange: number;
  attackWindup: number;
  attackRecover: number;
  visionRange: number;
  visionAngleDeg: number;
  hearingRange: number;
  hearingRadius: { gunshot: number; plantFire: number; running: number; playerHurt: number };
  sunDrop: number;
  headHeightRange: [number, number];
  legHeight: number;
  torsoHalfWidth: number;
  colliderRadius: number;
  colliderHeight: number;
  alertDuration: number;
  wanderRadius: number;
  hitReactDuration: number;
  hitReactMaxInterrupt: number;
  deathRemoveDelay: number;
  colliderDisableDelay: number;
  ambushTriggerRange: number;
  separationRadius: number;
  separationStrength: number;
  speedVariance: number;
  reactionVariance: number;
  stuckSeconds: number;
  breakCostMultiplier: number;
  lodMidDistance: number;
  lodFarDistance: number;
  lodMidHz: number;
  targeting: ZombieTargetingDef;
  /** Revision 2 (multi-type zombies): optional armour / prop that absorbs damage first. */
  armor?: ZombieArmorDef | null;
  /** Revision 2: special behaviours (pole vault, newspaper rage, charge). */
  abilities?: ZombieAbilitiesDef;
  /** Revision 2: per-type look (accessories, palette overrides, pose style). */
  visual: ZombieTypeVisualDef;
  /** Guard mode only (boss / imp): never in practice-mode spawn tables or normal wave pools (FR8.5). */
  guardOnly?: boolean;
}

export type ArmorKind = 'cone' | 'bucket' | 'newspaper' | 'screendoor' | 'helmet';
/** head: head hits only · body: head + torso · front: every zone, but only from within ±frontAngleDeg of facing. */
export type ArmorProtects = 'head' | 'body' | 'front';
/** telephonePole / impRider: guard mode gargantuar (pole weapon, imp riding on its back). */
export type ZombieAccessory = 'cone' | 'bucket' | 'helmet' | 'shoulderPads' | 'pole' | 'newspaper' | 'screendoor' | 'telephonePole' | 'impRider';
export type ZombiePoseStyle = 'normal' | 'newspaper' | 'screendoor' | 'football' | 'pole' | 'gargantuar' | 'imp';

export interface ZombieArmorDef {
  kind: ArmorKind;
  health: number;
  protects: ArmorProtects;
  /** Half-angle of the protected front arc (only used by protects = front). */
  frontAngleDeg: number;
  /** Accessory dropped as a tumbling prop when the armour breaks (null = shredded, nothing drops). */
  dropProp: ZombieAccessory | null;
  /** Accessories removed from the rig when the armour breaks. */
  parts: ZombieAccessory[];
  /** Metal armour plays a metallic impact sound. */
  metal: boolean;
}

export interface PoleVaultDef {
  /** Vault when the first plant / nut wall is within this distance (m) ahead while chasing. */
  triggerRange: number;
  /** Only plants within ±triggerAngleDeg of the facing direction count as "ahead". */
  triggerAngleDeg: number;
  duration: number;
  /** Landing point distance beyond the plant centre (m). */
  landingDistance: number;
  /** Chase speed after the pole is dropped. */
  speedAfter: number;
  dropProp: ZombieAccessory;
}

export interface NewspaperRageDef {
  /** Seconds of stomping / roaring before the zombie starts running. */
  rageDuration: number;
  chaseSpeedAfter: number;
  wanderSpeedAfter: number;
}

export interface ChargeDef {
  /** Charges at chaseSpeed while farther than this from its goal (m). */
  minDistance: number;
  /** Speed for the last metres before an attack. */
  approachSpeed: number;
}

/** Guard mode boss (gargantuar): overhead pole smash with a wind-up and an area of effect (FR8.3). */
export interface SmashDef {
  /** Seconds between starting the swing and the hit (no damage is dealt during the wind-up). */
  windup: number;
  /** Area radius around the impact point (m). */
  radius: number;
  /** Damage to the core per hit (before the difficulty core-damage multiplier). */
  damageVsCore: number;
  /** Damage to a player per hit (before the difficulty player-damage multiplier). */
  damageVsPlayer: number;
  /** Seconds after a hit before the next swing can start. */
  cooldown: number;
  /** Plants (nut walls included) inside the radius are destroyed outright. */
  destroysPlants: boolean;
}

/** Guard mode boss: throws one imp toward the defence line at the health threshold (FR8.4). */
export interface ThrowImpDef {
  /** Throw once when health / maxHealth falls to or below this fraction. */
  healthFraction: number;
  /** Zombie type id of the thrown imp. */
  impType: string;
  /** Landing distance ahead of the boss, toward the core (m). */
  throwDistance: number;
  flightTime: number;
}

export interface ZombieAbilitiesDef {
  poleVault?: PoleVaultDef;
  newspaperRage?: NewspaperRageDef;
  charge?: ChargeDef;
  smash?: SmashDef;
  throwImp?: ThrowImpDef;
}

export interface ZombieTypeVisualDef {
  accessories: ZombieAccessory[];
  poseStyle: ZombiePoseStyle;
  /** Replaces the global palette for the listed keys (e.g. football jersey colours). */
  palette?: Partial<Record<ZombiePaletteKey, string[]>>;
  /** False for types that hold a prop with both hands (no torn-off forearm). */
  allowMissingArm: boolean;
  /** Uniform body scale of the rig (guard mode: gargantuar ≈ 2, imp ≈ 0.6). Default 1. */
  bodyScale?: number;
}

export type ZombiesConfig = Record<string, ZombieDef>;

export type PlantCategory = 'economy' | 'combat' | 'barrier' | 'temporary';

export interface PlantDef {
  id: string;
  seedItemId: string;
  displayName: string;
  category: PlantCategory;
  health: number;
  footprintRadius: number;
  maxAlive: number;
  onlyByCharacter: string | null;
  sunPerSecond?: number;
  sunTickInterval?: number;
  attackDamage?: number;
  attackInterval?: number;
  attackRange?: number;
  attackDropRange?: number;
  turnSpeedDegPerSec?: number;
  fireAngleToleranceDeg?: number;
  targetEvalInterval?: number;
  slowPercent?: number;
  slowDuration?: number;
  destroyedByShareKillRange?: number;
  isPhysicalBlocker?: boolean;
  fuseSeconds?: number;
  explosionRadius?: number;
  explosionDamageCenter?: number;
  explosionDamageEdge?: number;
  triggerRadius?: number;
  rootDuration?: number;
  oneShotPerZombie?: boolean;
  isTemporary?: boolean;
}

export interface PlantingRules {
  maxPlacementDistance: number;
  maxSlopeDeg: number;
  plantAnimationTime: number;
  shovelAnimationTime: number;
  refundPercentOnShovel: number;
}

export interface PlantsConfig {
  plants: Record<string, PlantDef>;
  plantingRules: PlantingRules;
}

export type ShopCategory = 'ammo' | 'potion' | 'seed' | 'consumable' | 'equipment';

export type ItemEffect =
  | { type: 'ice'; slowPercent: number; slowDuration: number }
  | { type: 'power'; damageMultiplier: number }
  | { type: 'heal'; amount: number; useTime: number }
  | { type: 'permanentDamage'; bonus: number }
  | { type: 'permanentSun'; bonus: number };

export interface ShopItem {
  id: string;
  category: ShopCategory;
  price: number;
  maxCarry: number | null;
  durationSeconds?: number;
  name: string;
  desc: string;
  availableTo: string[];
  enabled?: boolean;
  effect?: ItemEffect;
}

export interface ShopConfig {
  items: ShopItem[];
  rules: { potionStacking: 'replace'; ammoAppliesImmediately: boolean; newbieSafetyPricing: boolean };
}

export type DoorSide = 'north' | 'south' | 'east' | 'west';
export type RoomId = 'hall' | 'backLeft' | 'backRight' | 'upstairs' | 'upstairsBack';

export interface BuildingDef {
  id: string;
  name: string;
  district: string;
  center: Vec2Tuple;
  size: Vec2Tuple;
  height: number;
  enterable: boolean;
  doorSide?: DoorSide;
  color: string;
  landmark?: 'clock' | 'supermarket';
}

export interface PlaceRef {
  pos?: Vec3Tuple;
  building?: string;
  room?: RoomId;
}

export interface ZombieSpawnerDef extends PlaceRef {
  id: string;
  type: string;
  maxAlive: number;
  respawnCooldown: number;
  activationRadius: number;
  mode: 'outdoor' | 'indoor';
  patrolRoute?: string;
}

export interface AmbushPointDef extends PlaceRef {
  id: string;
  count: number;
  trigger: 'player_inside';
}

export interface PickupPointDef extends PlaceRef {
  id: string;
  item: string;
  respawn: number;
}

export interface PropDef {
  id: string;
  kind: 'container' | 'ramp' | 'barricade' | 'car' | 'trashbin' | 'lamp' | 'gas_station' | 'fountain';
  pos: Vec3Tuple;
  rotYDeg?: number;
  slopeDeg?: number;
  size?: Vec3Tuple;
}

export interface ZoneDef {
  id: string;
  type: string;
  points: Vec2Tuple[];
}

export interface RectDef {
  id: string;
  name: string;
  rect: [number, number, number, number];
}

export interface MapConfig {
  id: string;
  size: Vec2Tuple;
  boundaryWallHeight: number;
  districts: RectDef[];
  highValueAreas: RectDef[];
  roads: { halfWidth: number; centerNoPlantHalfWidth: number };
  playerSpawns: { id: string; pos: Vec3Tuple }[];
  trainingDummy: Vec3Tuple;
  buildings: BuildingDef[];
  props: PropDef[];
  zombieSpawners: ZombieSpawnerDef[];
  /** Revision 2: per-district spawn weights by zombie type id (district id → type id → weight). */
  districtZombieTypes: Record<string, Record<string, number>>;
  ambushPoints: AmbushPointDef[];
  patrolRoutes: { id: string; waypoints: Vec3Tuple[] }[];
  pickupPoints: PickupPointDef[];
  plantableZones: ZoneDef[];
  nonPlantableZones: ZoneDef[];
  waypointGraph: {
    grid: { spacing: number; min: Vec2Tuple; max: Vec2Tuple; clearance: number };
    doorLinkRadius: number;
    nodes: { id: string; pos: Vec3Tuple }[];
    edges: [string, string][];
  };
}

export interface QualityPreset {
  shadows: boolean;
  shadowMapSize: number;
  particleScale: number;
  pixelRatioCap: number;
  drawDistance: number;
}

export interface GameConfig {
  loop: { fixedDt: number; maxSubSteps: number };
  movement: {
    standEyeHeight: number;
    crouchEyeHeight: number;
    capsuleRadius: number;
    capsuleHeight: number;
    walkSpeed: number;
    sprintMultiplier: number;
    crouchMultiplier: number;
    jumpSpeed: number;
    gravity: number;
    airControl: number;
    stepHeight: number;
    maxClimbSlopeDeg: number;
    fallRescueY: number;
    bobAmplitude: number;
    bobFrequency: number;
    landingImpactScale: number;
    interactRange: number;
    sensitivityDefault: number;
    sensitivityMin: number;
    sensitivityMax: number;
  };
  health: {
    lowHealthThreshold: number;
    lowHealthMoveMultiplier: number;
    respawnDelay: number;
    invulnerableAfterRespawn: number;
    regenDelay: number;
    regenPerSecond: number;
    regenCapFraction: number;
  };
  economy: {
    sunCap: number;
    headshotBonus: number;
    passiveTickInterval: number;
    sunPackAmount: number;
    sunPackLifetime: number;
    sunPackPickupRadius: number;
  };
  inventory: { hotbarSlots: number };
  spawnDirector: {
    globalMaxAlive: number;
    pressureInterval: number;
    pressureRateStep: number;
    pressureCapStep: number;
    maxPressureLevel: number;
    minSpawnDistance: number;
    defenseThreshold: number;
    defenseRadius: number;
    defenseRateMultiplier: number;
    lingerSeconds: number;
    lingerRateMultiplier: number;
    evalInterval: number;
    /** Type used where no district table applies (tutorial zombie, nav break cost reference). */
    defaultZombieType: string;
    /** Heavily armoured types whose weight grows with the pressure level. */
    heavyZombieTypes: string[];
    /** Heavy type weight × (1 + heavyWeightStep × pressure level). */
    heavyWeightStep: number;
    /** Max alive zombies of a type at the same time (types not listed: only the global cap). */
    zombieTypeCaps: Record<string, number>;
  };
  ui: { bannerDuration: number; ammoBannerCooldown: number; shopAnimTime: number; floatTextDuration: number };
  audio: { combatRadius: number; combatZombieCount: number; crossfadeTime: number; maxTotalMB: number };
  render: { quality: Record<'low' | 'medium' | 'high', QualityPreset> };
  zombieVisual: ZombieVisualConfig;
}

/** Body proportions of the zombie rig in metres (scale 1). Head must stay inside zombies.json headHeightRange. */
export interface ZombieProportions {
  ankleHeight: number;
  shinLength: number;
  thighLength: number;
  hipHalfWidth: number;
  spineOffset: number;
  torsoLength: number;
  torsoRadius: number;
  torsoDepthRatio: number;
  shoulderHalfWidth: number;
  shoulderDrop: number;
  neckLength: number;
  headRadius: number;
  headCenterOffset: number;
  upperArmLength: number;
  forearmLength: number;
  armRadius: number;
  legRadius: number;
}

export type ZombiePaletteKey = 'jacket' | 'shirt' | 'tie' | 'trousers' | 'skin' | 'hair' | 'shoe' | 'teeth' | 'eyes';

/** Procedural animation tunables (angles in degrees, times in seconds, distances in metres). */
export interface ZombieAnimationConfig {
  blendTime: number;
  deathBlendTime: number;
  strideLength: number;
  speedSmoothing: number;
  fullLocomotionSpeed: number;
  idle: { swayHz: number; swayRollDeg: number; twitchHz: number; twitchDeg: number; chewHz: number; chewOpenDeg: number; armHangDeg: number; elbowBendDeg: number; slouchDeg: number; kneeBendDeg: number };
  wander: { leanDeg: number; hipSwingDeg: number; kneeBendDeg: number; armSwingDeg: number; elbowBendDeg: number; shoulderTiltDeg: number; dragHipScale: number; dragAnkleDeg: number; pelvisTwistDeg: number; limpDip: number };
  alert: { headTurnMaxDeg: number; bodyFollow: number; bodyDelay: number; armRaiseDeg: number; jawOpenDeg: number; tremorHz: number; tremorDeg: number; headBackDeg: number };
  chase: { leanDeg: number; hipSwingDeg: number; kneeBendDeg: number; armReachDeg: number; armBobDeg: number; elbowBendDeg: number; lurchRollDeg: number; jawOpenDeg: number; jawHz: number; headTrackDeg: number; limpScale: number };
  attack: { readyLeanDeg: number; readyArmDeg: number; windupLeanDeg: number; windupArmDeg: number; windupElbowDeg: number; lungeTime: number; lungeLeanDeg: number; lungeArmDeg: number; lungeElbowDeg: number; lungeDistance: number; jawOpenDeg: number };
  break: { poundHz: number; armHighDeg: number; armLowDeg: number; elbowHighDeg: number; elbowLowDeg: number; leanDeg: number; slamDip: number; jawOpenDeg: number };
  hitReact: { peakTime: number; leanBackDeg: number; headWhipDeg: number; twistDeg: number; armFlingDeg: number; pushBack: number };
  death: { buckleTime: number; fallTime: number; settleTime: number; kneeBuckleDeg: number; forwardChance: number; bounceDeg: number; groundLift: number; armFlingDeg: number };
  ambush: { crouchHipDeg: number; crouchKneeDeg: number; crouchLeanDeg: number; riseTime: number; breathHz: number; breathDeg: number };
  rooted: { struggleHz: number; twistDeg: number; armFlailDeg: number; leanDeg: number; fadeRate: number };
  /** Revision 2: pole vault (phases are fractions of the vault duration, driven by the gameplay vault progress). */
  vault: {
    plantEnd: number; flightEnd: number; arcHeight: number; carryArmDeg: number; carryElbowDeg: number;
    plantArmDeg: number; plantLeanDeg: number; tuckHipDeg: number; tuckKneeDeg: number; flightPitchDeg: number;
    landKneeDeg: number; landLeanDeg: number;
  };
  /** Revision 2: newspaper rage (stomp + roar) and the raged run. */
  rage: {
    stompHz: number; stompHipDeg: number; stompKneeDeg: number; roarJawDeg: number; roarBackDeg: number;
    fistShakeHz: number; fistShakeDeg: number; armDownDeg: number; elbowDeg: number; runHipScale: number; runArmPumpDeg: number;
  };
  newspaper: { armDeg: number; elbowDeg: number; headDownDeg: number; pageTurnHz: number; pageTurnDeg: number };
  screendoor: { armDeg: number; elbowDeg: number; leanDeg: number };
  charge: { leanDeg: number; headDownDeg: number; armDeg: number; elbowDeg: number; hipSwingScale: number };
  /** Guard mode boss: heavy walk, overhead pole smash, imp throw (FR8.6). */
  gargantuar: {
    stanceWidthDeg: number; stompDip: number; swayRollDeg: number; leanDeg: number; poleArmDeg: number; poleElbowDeg: number;
    smashRaiseDeg: number; smashSlamDeg: number; smashLeanBackDeg: number; smashLeanDeg: number; smashCrouchDeg: number;
    throwTime: number; throwBackDeg: number; throwReleaseDeg: number;
  };
  /** Guard mode imp: quick scurrying run. */
  imp: { leanDeg: number; hipSwingScale: number; armPumpDeg: number; elbowDeg: number; bounce: number };
  /** Head flinch multiplier when the hit landed on armour. */
  armorHitHeadScale: number;
}

/** Rendering of dropped armour props (tumble, rest, fade). */
export interface DroppedPropConfig {
  maxActive: number;
  restSeconds: number;
  fadeSeconds: number;
  launchSpeed: number;
  spinSpeed: number;
  gravity: number;
  /** Fraction of the vertical speed kept on each ground bounce (0..1). */
  bounce: number;
}

export interface ZombieVisualConfig {
  cullDistance: number;
  proportions: ZombieProportions;
  segments: { radial: number; sphereWidth: number; sphereHeight: number; lathe: number };
  variation: {
    heightScale: [number, number];
    buildScale: [number, number];
    missingArmChance: number;
    headTiltChance: number;
    headTiltMaxDeg: number;
    limpChance: number;
  };
  palettes: Record<ZombiePaletteKey, string[]>;
  /** Revision 2: base colours of armour / prop accessories (baked into the accessory vertex colours). */
  accessoryColors: Record<ZombieAccessory, string>;
  droppedProps: DroppedPropConfig;
  animation: ZombieAnimationConfig;
}

// ---------- guard mode: ring map (map_ring_01.json) ----------

export type RingId = 'outer' | 'middle' | 'inner';

export interface RingDef {
  id: RingId;
  /** Lane centre-line radius (m). */
  radius: number;
}

export interface PolarPoint {
  radius: number;
  angleDeg: number;
}

export interface RingEntranceDef {
  id: string;
  /** Angle of the gap in the outer wall; positions use x = r·cos θ, z = r·sin θ. */
  angleDeg: number;
  width: number;
  /** Spawn point group bound to this entrance (FR2-MAP-03). */
  spawnPoints: PolarPoint[];
}

export interface RingRampDef {
  id: string;
  from: RingId;
  to: RingId;
  angleDeg: number;
  width: number;
  slopeDeg: number;
}

export interface RingStairDef {
  id: string;
  angleDeg: number;
  width: number;
}

export type RingLandmarkKind = 'tower' | 'water_tower' | 'container_yard';

export interface RingMapConfig {
  id: string;
  kind: 'ring';
  size: Vec2Tuple;
  /** Ordered outer → inner; radii strictly decreasing. */
  rings: RingDef[];
  laneWidth: number;
  wallHeight: number;
  outerWallThickness: number;
  /** Raised walkway on top of the wall band between two rings (second layer). */
  elevated: { between: [RingId, RingId]; fromDeg: number; toDeg: number; height: number; railHeight: number };
  core: { center: Vec2Tuple; size: Vec2Tuple; height: number; doorSide: DoorSide; doorWidth: number };
  entrances: RingEntranceDef[];
  ramps: RingRampDef[];
  stairs: RingStairDef[];
  playerSpawns: { id: string; pos: Vec3Tuple }[];
  landmarks: { id: string; kind: RingLandmarkKind; pos: PolarPoint }[];
  nav: { laneNodeSpacing: number; coreApproachDistance: number };
  /** Wall segments approximate the arcs at this angular step. */
  wallSegmentDeg: number;
}

export interface MapsConfig {
  city_01: MapConfig;
  ring_01: RingMapConfig;
}

// ---------- guard mode: difficulty and waves (challenge.json) ----------

export type DifficultyId = 'easy' | 'standard' | 'hard';

export interface DifficultyDef {
  waves: number;
  firstWaveCount: number;
  waveIncrement: number;
  waveCap: number;
  zombieHealthMultiplier: number;
  playerDamageMultiplier: number;
  coreDamageMultiplier: number;
  countdownSeconds: number;
  entranceCap: number;
  sunIncomeMultiplier: number;
  coreHealth: number;
  /** Boss health for this difficulty (replaces the health multiplier for the boss). */
  bossHealth: number;
}

export interface WaveTypeUnlock {
  type: string;
  /** First wave (1-based) in which this type can appear. */
  fromWave: number;
  weight: number;
}

export interface ChallengeConfig {
  difficulties: Record<DifficultyId, DifficultyDef>;
  waves: {
    typeUnlocks: WaveTypeUnlock[];
    /** Seconds between spawns inside wave 1; each later wave multiplies by intervalFactor. */
    spawnIntervalBase: number;
    spawnIntervalFactor: number;
    spawnIntervalMin: number;
    /** Open entrance count from a given wave on (before the difficulty entrance cap). */
    entranceCurve: { fromWave: number; open: number }[];
    /** Max zombies alive at once (performance budget). */
    maxAlive: number;
    bossType: string;
  };
  core: {
    /** Health fractions at which damage stages 1..4 begin (strictly decreasing, last = 0). */
    damageStages: number[];
    lowHealthFraction: number;
  };
  targeting: { playerApproachRadius: number; plantApproachRadius: number };
  spawnRule: { minPlayerDistance: number; coreDirectionHalfAngleDeg: number };
}

export interface AllConfig {
  characters: Record<string, CharacterDef>;
  weapons: WeaponsConfig;
  zombies: ZombiesConfig;
  plants: PlantsConfig;
  shop: ShopConfig;
  maps: MapsConfig;
  challenge: ChallengeConfig;
  game: GameConfig;
}
