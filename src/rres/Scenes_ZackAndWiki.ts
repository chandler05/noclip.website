
import * as BRRES from './brres';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BasicRRESRenderer } from './scenes';
import { SceneContext } from '../SceneBase';
import { assert, assertExists, readString } from '../util';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from './render';
import AnimationController from '../AnimationController';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GXMaterialHacks } from '../gx/gx_material';
import { mat4, vec3 } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';

const pathBase = `zack_and_wiki`;

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.65 * (${p.ambSource} + 0.5) * ${p.matSource})`,
};

class ZackAndWikiRender extends BasicGXRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    private animationController: AnimationController;

    private scn0Animators: BRRES.SCN0Animator[] = [];
    private lightSettings: BRRES.LightSetting[] = [];

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public objectsRRESes: ObjectEntry[], public textureHolder = new RRESTextureHolder()) {
        super(device);

        this.animationController = new AnimationController();

        console.log("CREATED")

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            this.textureHolder.addRRESTextures(device, stageRRES);

            let lightSetting: BRRES.LightSetting | null = null;

            if (stageRRES.scn0.length > 0) {
                lightSetting = new BRRES.LightSetting();
                const scn0Animator = new BRRES.SCN0Animator(this.animationController, stageRRES.scn0[0]);
                this.lightSettings.push(lightSetting);
                this.scn0Animators.push(scn0Animator);
            }

            for (let j = 0; j < stageRRES.mdl0.length; j++) {
                const model = new MDL0Model(device, this.getCache(), stageRRES.mdl0[j], lightSetting ? undefined : materialHacks);
                this.models.push(model);
                const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
                this.modelInstances.push(modelRenderer);
                modelRenderer.bindRRESAnimations(this.animationController, stageRRES);

                if (lightSetting !== null)
                    modelRenderer.bindLightSetting(lightSetting);
            }
        }

        for (let i = 0; i < objectsRRESes.length; i++) {
            const objRRES = objectsRRESes[i].rres;
            this.textureHolder.addRRESTextures(device, objRRES);

            let lightSetting: BRRES.LightSetting | null = null;

            if (objRRES.scn0.length > 0) {
                lightSetting = new BRRES.LightSetting();
                const scn0Animator = new BRRES.SCN0Animator(this.animationController, objRRES.scn0[0]);
                this.lightSettings.push(lightSetting);
                this.scn0Animators.push(scn0Animator);
            }

            for (let j = 0; j < objRRES.mdl0.length; j++) {
                const model = new MDL0Model(device, this.getCache(), objRRES.mdl0[j], lightSetting ? undefined : materialHacks);
                this.models.push(model);
                const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
                mat4.translate(modelRenderer.modelMatrix, modelRenderer.modelMatrix, objectsRRESes[i].translation);
                mat4.rotateX(modelRenderer.modelMatrix, modelRenderer.modelMatrix, objectsRRESes[i].rotation[0] * (Math.PI/180));
                mat4.rotateY(modelRenderer.modelMatrix, modelRenderer.modelMatrix, objectsRRESes[i].rotation[1] * (Math.PI/180));
                mat4.rotateZ(modelRenderer.modelMatrix, modelRenderer.modelMatrix, objectsRRESes[i].rotation[2] * (Math.PI/180));
                this.modelInstances.push(modelRenderer);
                modelRenderer.bindRRESAnimations(this.animationController, objRRES);

                if (lightSetting !== null)
                    modelRenderer.bindLightSetting(lightSetting);
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.modelInstances.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.modelInstances);
            panels.push(layersPanel);
        }

        return panels;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        for (let i = 0; i < this.scn0Animators.length; i++)
            this.scn0Animators[i].calcLightSetting(this.lightSettings[i]);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public override destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
    }
}

interface UntranslatedObjectEntry {
    modelPath: string;
    translation: vec3;
    rotation: vec3;
}

interface ObjectEntry {
    rres: BRRES.RRES;
    translation: vec3;
    rotation: vec3;
}

function parseTxt(file: ArrayBufferSlice): UntranslatedObjectEntry[] {
    const text = readString(file, 0x00, file.byteLength);
    console.log(text);
    const rooms = text.split("STG");

    const objects: UntranslatedObjectEntry[] = [];

    for (let i = 0; i < rooms.length - 1; i++) {
        const lines = rooms[i + 1].split("\n");
        for (let j = 4; j < lines.length; j++) {
            const modelPath = lines[j].split("\t")[1];
            lines[j] = lines[j].substring(lines[j].indexOf(modelPath) + modelPath.length + 1);
            if (lines[j].match(/^\s*$/) !== null) {
                break;
            }

            console.log(lines[j])

            const rotation = vec3.fromValues(findNextNum(lines[j], 8), findNextNum(lines[j], 9), findNextNum(lines[j], 10));

            const translation = vec3.fromValues(findNextNum(lines[j], 11), findNextNum(lines[j], 12), findNextNum(lines[j], 13));

            console.log(modelPath);

            if (modelPath.startsWith("ITM") || modelPath.startsWith("FIG")) {
                objects.push({modelPath: `${pathBase}/Items/${modelPath}.brres`, translation, rotation});
            } else {
                objects.push({modelPath: `${pathBase}/Model/${modelPath}.brres`, translation, rotation});
            }
            
        }
    }
    return objects;
}

function findNextNum(text: string, skip?: number): number {
    if (skip !== undefined) {
        for (let i = 0; i < skip; i++) {
            text = text.replace(/(\d|-|\.)+/, "");
        }
    }
    const num = text.match(/(\d|-|\.)+/);
    assert(num !== null && num.index !== undefined);
    text = text.substring(num.index + num[0].length);
    console.log(parseInt(num[0]));
    return parseInt(num[0]);
}

function createObjects(untranslatedObjects: UntranslatedObjectEntry[], dataFetcher: DataFetcher, defaultPath: string): Promise<ObjectEntry[]> {
    return new Promise(objects => {
        let objs: ObjectEntry[] = [];
        for (let i = 0; i < untranslatedObjects.length; i++) {
            dataFetcher.fetchData(untranslatedObjects[i].modelPath).then((buffer: ArrayBufferSlice) => {
                if (buffer !== undefined) {
                    const modelRRES = BRRES.parse(buffer);
    
                    objs.push({rres: modelRRES, translation: untranslatedObjects[i].translation, rotation: untranslatedObjects[i].rotation});
                    if (objs.length === untranslatedObjects.length) {
                        objects(objs);
                    }
                } else {
                    console.warn(`Could not find ${untranslatedObjects[i].modelPath}`);
                    objs = [];
                    dataFetcher.fetchData(defaultPath).then((buffer: ArrayBufferSlice) => {
                        const modelRRES = BRRES.parse(buffer);
        
                        objs.push({rres: modelRRES, translation: untranslatedObjects[i].translation, rotation: untranslatedObjects[i].rotation});
                        objects(objs);
                    }); 
                }
            }); 
        }
    });
}

class ZackAndWikiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        
        const mainStagePath = `${pathBase}/Stage/${this.id}_ALL.brres`;
        const modelsPath = `${pathBase}/Stage/${this.id}_3.txt`;
        const defaultPath = `${pathBase}/Model/SCR${this.id.substring(3)}_ALL.brres`;
         
        return Promise.all([dataFetcher.fetchData(mainStagePath), dataFetcher.fetchData(modelsPath)]).then(([mainStageBuffer, modelsBuffer]) => {
            const mainRRES = BRRES.parse(mainStageBuffer);

            const unObjects = parseTxt(modelsBuffer);

            return createObjects(unObjects, dataFetcher, defaultPath).then((objects) => {
                return new ZackAndWikiRender(device, [mainRRES], objects);
            });
        });

        /*
        return dataFetcher.fetchData(`${pathBase}/Stage/${this.id}_ALL.brres`).then((buffer: ArrayBufferSlice) => {
            const mainRRES = BRRES.parse(buffer);
            return dataFetcher.fetchData(`${pathBase}/Model/SCR_xx_012.brres`).then((buffer: ArrayBufferSlice): Viewer.SceneGfx => {
                const model = BRRES.parse(buffer);
                return new BasicRRESRenderer(device, [mainRRES]);
            });
        });*/
    }
}

class ZackAndWikiAlternateSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public altString?: string, public customTranslation: vec3 = [0,0,0]) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(`${pathBase}/Stage/${this.id}_ALL.brres`).then((buffer: ArrayBufferSlice) => {
            const mainRRES = BRRES.parse(buffer);
            return dataFetcher.fetchData(`${pathBase}/Model/SCR${this.altString ? this.altString.substring(3) : this.id.substring(3)}_ALL.brres`).then((buffer: ArrayBufferSlice): Viewer.SceneGfx => {
                const model = BRRES.parse(buffer);
                
                const objects: ObjectEntry[] = [{rres: model, translation: this.customTranslation, rotation: [0,0,0]}];

                return new ZackAndWikiRender(device, [mainRRES], objects);
            });
        });
    }
}

const id = 'zack_and_wiki';
const name = "Zack & Wiki: Quest for Barbaros' Treasure";
const sceneDescs = [
    "Tutorial",
    new ZackAndWikiSceneDesc("STG_00_00", "Tutorial"),
    new ZackAndWikiAlternateSceneDesc("STG_01_00", "Tutorial", "SCR_01"),
    "Jungle Ruins",
    new ZackAndWikiSceneDesc("STG_02_00", "Pit of Tradgedy"),
    new ZackAndWikiSceneDesc("STG_02_01", "Flute of the Growling Goblins"),
    new ZackAndWikiSceneDesc("STG_02_02", "Fish One"),
    new ZackAndWikiSceneDesc("STG_02_04", "Three Collosi"),
    new ZackAndWikiSceneDesc("STG_02_05", "King of the Jungle"),
    "Ice World",
    new ZackAndWikiAlternateSceneDesc("STG_03_00", "Key Freezing"),
    new ZackAndWikiAlternateSceneDesc("STG_03_01", "Keeper of the Ice"),
    new ZackAndWikiAlternateSceneDesc("STG_03_02", "Drill"),
    new ZackAndWikiAlternateSceneDesc("STG_03_03", "Broken"),
    new ZackAndWikiAlternateSceneDesc("STG_03_04", "One I Forgot"),
    new ZackAndWikiAlternateSceneDesc("STG_03_05", "Frost Breath"),
    "Volcano",
    new ZackAndWikiSceneDesc("STG_04_00", "Volcano 1"),
    new ZackAndWikiSceneDesc("STG_04_01", "Lava"),
    new ZackAndWikiSceneDesc("STG_04_02", "Lava 2"),
    new ZackAndWikiSceneDesc("STG_04_03", "Lava 3"),
    new ZackAndWikiSceneDesc("STG_04_04", "Lava 4"),
    new ZackAndWikiSceneDesc("STG_04_05", "Dragon Boss"),
    "Airplane",
    new ZackAndWikiAlternateSceneDesc("STG_05_00", "Airplane", "SCR_05"),
    "Creepy Mansion",
    new ZackAndWikiSceneDesc("STG_06_00", "Belltower"),
    new ZackAndWikiSceneDesc("STG_06_01", "Stage 6 2"),
    new ZackAndWikiSceneDesc("STG_06_02", "Stage 6 3"),
    new ZackAndWikiSceneDesc("STG_06_03", "Stage 6 4"),
    new ZackAndWikiSceneDesc("STG_06_04", "Stage 6 5"),
    new ZackAndWikiSceneDesc("STG_06_05", "Stage 6 6"),
    "Boat",
    new ZackAndWikiAlternateSceneDesc("STG_07_00", "Kraken Boat", "SCR_07"),
    new ZackAndWikiSceneDesc("STG_07_01", "Stage 7 2"),
    new ZackAndWikiSceneDesc("STG_07_02", "Stage 7 3"),
    "Treasure Island",
    new ZackAndWikiAlternateSceneDesc("STG_08_00", "Treasure Island"),
    new ZackAndWikiAlternateSceneDesc("STG_08_01", "Final Boss"),
    new ZackAndWikiSceneDesc("STG_08_02", "Stage 8 3"),
    "?",
    new ZackAndWikiAlternateSceneDesc("STG_09_02", "Bookshelf", "SCR_09"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
