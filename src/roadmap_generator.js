// État global de l'application
let currentStep = 1;
let excelWorkbook = null;
let excelData = null;
let detectedWorkPackages = [];

let config = {
    file: null,
    sheet: null,
    columns: {},
    wpMapping: {},
    userJourneys: [],
    workPackages: [],
    thresholds: [0, 40, 60, 80, 100],
    colors: ['#FF0000', '#FF6600', '#FF9900', '#FFCC00', '#99CC00', '#00CC00']
};

// ==============================================
// NAVIGATION ENTRE LES ÉTAPES
// ==============================================

document.getElementById('nextBtn').addEventListener('click', () => {
    if (currentStep < 5) {
        currentStep++;
        updateSteps();
    }
});

document.getElementById('prevBtn').addEventListener('click', () => {
    if (currentStep > 1) {
        currentStep--;
        updateSteps();
    }
});

function updateSteps() {
    document.querySelectorAll('.section').forEach((section, index) => {
        section.classList.toggle('active', index + 1 === currentStep);
    });
    
    document.querySelectorAll('.step').forEach((step, index) => {
        const stepNum = index + 1;
        step.classList.remove('active', 'completed');
        if (stepNum === currentStep) {
            step.classList.add('active');
        } else if (stepNum < currentStep) {
            step.classList.add('completed');
        }
    });
    
    document.getElementById('prevBtn').style.display = currentStep > 1 ? 'block' : 'none';
    document.getElementById('nextBtn').style.display = currentStep < 5 ? 'block' : 'none';
    
    if (currentStep === 5) {
        prepareGenerationSummary();
    }
    
    updateNextButton();
}

function updateNextButton() {
    const btn = document.getElementById('nextBtn');
    let canProceed = false;
    
    switch(currentStep) {
        case 1:
            canProceed = excelData !== null;
            break;
        case 2:
            const hasBasicCols = ['userjourney', 'epic', 'stage', 'substage', 'description', 'workpackage'].every(
                col => config.columns[col] !== undefined
            );
            const hasWPMappings = detectedWorkPackages.length === 0 || 
                detectedWorkPackages.every(wp => config.wpMapping[wp] !== undefined);
            canProceed = hasBasicCols && hasWPMappings;
            break;
        case 3:
            canProceed = config.userJourneys.length > 0 && config.workPackages.length > 0;
            break;
        case 4:
            canProceed = true;
            break;
    }
    
    btn.disabled = !canProceed;
}

// ==============================================
// ÉTAPE 1: CHARGEMENT DU FICHIER
// ==============================================

document.getElementById('excelFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        config.file = file.name;
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileLabel').classList.add('has-file');
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                excelWorkbook = XLSX.read(data, {type: 'array'});
                
                const sheetSection = document.getElementById('sheetSelection');
                const sheetSelect = document.getElementById('sheetSelect');
                
                sheetSection.style.display = 'block';
                sheetSelect.innerHTML = '';
                
                excelWorkbook.SheetNames.forEach(sheetName => {
                    const option = document.createElement('option');
                    option.value = sheetName;
                    option.textContent = sheetName;
                    sheetSelect.appendChild(option);
                });
                
                if (excelWorkbook.SheetNames.length === 1) {
                    sheetSelect.value = excelWorkbook.SheetNames[0];
                    loadSheet(excelWorkbook.SheetNames[0]);
                }
                
                showStatus('Fichier chargé! ' + excelWorkbook.SheetNames.length + ' onglet(s)', 'success');
            } catch (error) {
                showStatus('Erreur: ' + error.message, 'error');
                console.error(error);
            }
        };
        reader.readAsArrayBuffer(file);
    }
});

document.getElementById('sheetSelect').addEventListener('change', function(e) {
    if (e.target.value) {
        loadSheet(e.target.value);
    }
});

function loadSheet(sheetName) {
    try {
        const worksheet = excelWorkbook.Sheets[sheetName];
        excelData = XLSX.utils.sheet_to_json(worksheet, {header: 1});
        config.sheet = sheetName;
        
        populateColumnSelectors();
        
        showStatus('Onglet "' + sheetName + '" chargé (' + (excelData.length - 1) + ' lignes)', 'success');
        updateNextButton();
    } catch (error) {
        showStatus('Erreur: ' + error.message, 'error');
        console.error(error);
    }
}

// ==============================================
// ÉTAPE 2: MAPPING DES COLONNES
// ==============================================

function populateColumnSelectors() {
    const headers = excelData[0];
    const selectors = [
        'colUserJourney', 'colEpic', 'colStage', 'colSubstage',
        'colDescription', 'colWorkPackage'
    ];
    
    selectors.forEach(selectorId => {
        const select = document.getElementById(selectorId);
        select.innerHTML = '<option value="">-- Choisir une colonne --</option>';
        headers.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = header || `Colonne ${index + 1}`;
            select.appendChild(option);
        });
        
        select.addEventListener('change', function() {
            updateColumnMapping(selectorId, this.value);
        });
    });
    
    autoSelectColumns(headers);
}

function autoSelectColumns(headers) {
    const mapping = {
        'colUserJourney': ['user journey', 'journey', 'uj'],
        'colEpic': ['epic', 'epics'],
        'colStage': ['stage'],
        'colSubstage': ['substage', 'sub-stage'],
        'colDescription': ['description', 'desc', 'feature'],
        'colWorkPackage': ['target', 'work package', 'wp', 'workpackage']
    };
    
    Object.keys(mapping).forEach(selectorId => {
        const keywords = mapping[selectorId];
        const index = headers.findIndex(h => 
            keywords.some(kw => h && h.toLowerCase().includes(kw))
        );
        if (index !== -1) {
            document.getElementById(selectorId).value = index;
            updateColumnMapping(selectorId, index);
        }
    });
}

function updateColumnMapping(selectorId, columnIndex) {
    const key = selectorId.replace('col', '').toLowerCase();
    config.columns[key] = parseInt(columnIndex);
    
    if (key === 'userjourney') {
        populateUserJourneyFilters();
    }
    if (key === 'workpackage') {
        detectWorkPackagesAndShowMapping();
    }
    
    updateNextButton();
}

function detectWorkPackagesAndShowMapping() {
    const colIndex = config.columns.workpackage;
    if (colIndex === undefined) return;
    
    // Détecter tous les Work Packages uniques
    const wpSet = new Set();
    excelData.slice(1).forEach(row => {
        if (row[colIndex]) wpSet.add(row[colIndex]);
    });
    
    detectedWorkPackages = Array.from(wpSet).sort();
    
    // Afficher la section de mapping WP → Progression
    const section = document.getElementById('wpMappingSection');
    const container = document.getElementById('wpMappingContainer');
    
    if (detectedWorkPackages.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    container.innerHTML = '';
    
    const headers = excelData[0];
    
    detectedWorkPackages.forEach(wp => {
        const div = document.createElement('div');
        div.className = 'wp-mapping-item';
        
        const label = document.createElement('div');
        label.className = 'mapping-label';
        label.textContent = `${wp}:`;
        
        const select = document.createElement('select');
        select.innerHTML = '<option value="">-- Choisir colonne de progression --</option>';
        headers.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = header || `Colonne ${index + 1}`;
            select.appendChild(option);
        });
        
        // Auto-sélection
        const wpLower = String(wp).toLowerCase();
        const autoIndex = headers.findIndex(h => 
            h && (String(h).toLowerCase().includes(wpLower) || String(h).toLowerCase().includes('progression'))
        );
        if (autoIndex !== -1) {
            select.value = autoIndex;
            config.wpMapping[wp] = autoIndex;
        }
        
        select.addEventListener('change', function() {
            config.wpMapping[wp] = parseInt(this.value);
            updateNextButton();
        });
        
        div.appendChild(label);
        div.appendChild(select);
        container.appendChild(div);
    });
    
    updateNextButton();
}

// ==============================================
// ÉTAPE 3: FILTRES
// ==============================================

function populateUserJourneyFilters() {
    const colIndex = config.columns.userjourney;
    if (colIndex === undefined) return;
    
    const values = new Set();
    excelData.slice(1).forEach(row => {
        if (row[colIndex]) values.add(row[colIndex]);
    });
    
    const container = document.getElementById('userJourneyCheckboxes');
    container.innerHTML = '';
    
    Array.from(values).sort().forEach(value => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `
            <input type="checkbox" id="uj_${value}" value="${value}" />
            <label for="uj_${value}">${value}</label>
        `;
        div.querySelector('input').addEventListener('change', updateUserJourneySelection);
        container.appendChild(div);
    });
}

function updateUserJourneySelection() {
    config.userJourneys = Array.from(
        document.querySelectorAll('#userJourneyCheckboxes input:checked')
    ).map(cb => cb.value);
    updateNextButton();
}

// Populate work package checkboxes from detected WPs
function populateWorkPackageCheckboxes() {
    const container = document.getElementById('workPackageCheckboxes');
    container.innerHTML = '';
    
    detectedWorkPackages.forEach(wp => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `
            <input type="checkbox" id="wp_${wp}" value="${wp}" checked />
            <label for="wp_${wp}">${wp}</label>
        `;
        div.querySelector('input').addEventListener('change', updateWorkPackageSelection);
        container.appendChild(div);
    });
    
    updateWorkPackageSelection();
}

function updateWorkPackageSelection() {
    config.workPackages = Array.from(
        document.querySelectorAll('#workPackageCheckboxes input:checked')
    ).map(cb => cb.value);
    updateNextButton();
}

// Populate WP checkboxes when moving to step 3
document.getElementById('nextBtn').addEventListener('click', () => {
    if (currentStep === 3) {
        populateWorkPackageCheckboxes();
    }
});

// ==============================================
// ÉTAPE 4: COULEURS
// ==============================================

function setupColorInputs() {
    const thresholdsCount = config.thresholds.length
    for (let i = 0; i <= thresholdsCount; i++) {
        const colorInput = document.getElementById(`color${i}`);
        const preview = document.getElementById(`preview${i}`);
        
        colorInput.addEventListener('input', function() {
            config.colors[i] = this.value;
            preview.style.background = this.value;
        });
    }
    
    [1, 2, 3].forEach(i => {
        const input = document.getElementById(`threshold${i}`);
        input.addEventListener('input', function() {
            config.thresholds[i] = parseInt(this.value);
            if (i < thresholdsCount-1) {
                document.getElementById(`threshold${i}Display`).textContent = this.value;

                let previewB = config.thresholds[i] + (config.thresholds[i+1]-config.thresholds[i])/2
                let previewA = config.thresholds[i-1] + (config.thresholds[i]-config.thresholds[i-1])/2

                document.getElementById(`preview${i}`).textContent = previewA;
                document.getElementById(`preview${i+1}`).textContent = previewB;
            }
        });
    });
}
setupColorInputs();

// ==============================================
// ÉTAPE 5: GÉNÉRATION
// ==============================================

function prepareGenerationSummary() {
    const summary = document.getElementById('configSummary');
    summary.innerHTML = `
        <h3 style="margin-bottom: 10px; color: #333;">📋 Résumé de configuration</h3>
        <p><strong>Fichier:</strong> ${config.file} (Onglet: ${config.sheet})</p>
        <p><strong>User Journeys:</strong> ${config.userJourneys.join(', ')}</p>
        <p><strong>Work Packages:</strong> ${config.workPackages.join(', ')}</p>
        <p><strong>Seuils:</strong> ${config.thresholds[1]}%, ${config.thresholds[2]}%, ${config.thresholds[3]}%</p>
    `;
}

document.getElementById('generateBtn').addEventListener('click', generateDiagram);

function generateDiagram() {
    document.getElementById('loader').classList.add('active');
    document.getElementById('status').style.display = 'none';
    
    setTimeout(() => {
        try {
            const drawioXml = generateDrawioXml();
            
            if (!drawioXml || drawioXml.length < 100) {
                throw new Error('Le XML généré est vide ou invalide');
            }
            
            const filename = `roadmap_${config.userJourneys.join('_')}.drawio`;
            downloadDrawio(drawioXml, filename);
            
            document.getElementById('loader').classList.remove('active');
            showStatus('✓ Diagramme généré avec succès!', 'success');
        } catch (error) {
            document.getElementById('loader').classList.remove('active');
            showStatus('Erreur: ' + error.message, 'error');
            console.error('Erreur complète:', error);
        }
    }, 500);
}

// ==============================================
// GÉNÉRATION DU XML DRAW.IO
// ==============================================

function generateDrawioXml() {
    console.log('Début de génération...');
    console.log('Config:', config);
    
    const headers = excelData[0];
    const rows = excelData.slice(1);
    
    const colIdx = {
        userJourney: config.columns.userjourney,
        epic: config.columns.epic,
        stage: config.columns.stage,
        substage: config.columns.substage,
        description: config.columns.description,
        workPackage: config.columns.workpackage
    };
    
    console.log('Indices de colonnes:', colIdx);
    
    // Organiser les données
    const structure = {};
    const progressions = {};
    const targets = {};
    
    rows.forEach((row, idx) => {
        const userJourney = row[colIdx.userJourney];
        const epic = row[colIdx.epic];
        const stage = row[colIdx.stage];
        let substage = row[colIdx.substage];
        const description = row[colIdx.description];
        const workPackage = row[colIdx.workPackage];
        
        // Filtrer selon les User Journeys sélectionnés
        if (!config.userJourneys.includes(userJourney)) return;
        if (!epic || !stage || !description) return;
        
        // Gérer les substages vides
        if (substage === undefined || substage === null || substage === '' || substage === 0) {
            substage = '0';
        }
        
        // Initialiser les structures
        if (!structure[epic]) structure[epic] = {};
        if (!structure[epic][stage]) structure[epic][stage] = {};
        if (!structure[epic][stage][substage]) structure[epic][stage][substage] = [];
        
        if (!progressions[epic]) progressions[epic] = {};
        if (!progressions[epic][stage]) progressions[epic][stage] = {};
        if (!progressions[epic][stage][substage]) progressions[epic][stage][substage] = {};
        
        if (!targets[epic]) targets[epic] = {};
        if (!targets[epic][stage]) targets[epic][stage] = {};
        if (!targets[epic][stage][substage]) targets[epic][stage][substage] = {};
        
        structure[epic][stage][substage].push(description);
        
        // Récupérer les progressions pour chaque WP
        config.workPackages.forEach(wp => {
            if (!progressions[epic][stage][substage][wp]) {
                progressions[epic][stage][substage][wp] = [];
            }
            
            // Obtenir la colonne de progression pour ce WP
            const progressionCol = config.wpMapping[wp];
            if (progressionCol !== undefined) {
                const value = parseFloat(row[progressionCol]) || 0;
                progressions[epic][stage][substage][wp].push(value);
            }
            
            // Marquer si ce WP est présent
            if (workPackage === wp) {
                targets[epic][stage][substage][wp] = true;
            }
        });
    });
    
    console.log('Structure:', structure);
    console.log('Progressions:', progressions);
    console.log('Targets:', targets);
    
    if (Object.keys(structure).length === 0) {
        throw new Error('Aucune donnée trouvée avec les filtres sélectionnés');
    }
    
    // Générer le XML Draw.io
    return generateDrawioStructure(structure, progressions, targets);
}

function generateDrawioStructure(structure, progressions, targets) {
    const colorPalettes = [
        ['#4472C4', '#6B8DD6', '#92ABE3'],
        ['#ED7D31', '#F19658', '#F5B183'],
        ['#A5A5A5', '#B8B8B8', '#CBCBCB'],
        ['#FFC000', '#FFCD33', '#FFD966'],
        ['#5B9BD5', '#7BB2E0', '#9BC9EB'],
        ['#70AD47', '#8BBE65', '#A6CE83'],
        ['#264478', '#3D5F99', '#5479BA'],
        ['#9E480E', '#B8662A', '#D28446'],
        ['#636363', '#7E7E7E', '#999999']
    ];
    
    const SUBSTAGE_WIDTH = 110;
    const STAGE_HEIGHT = 80;
    const SUBSTAGE_HEIGHT = 80;
    const WP_HEIGHT = 20;
    const PADDING = 10;
    const LABEL_WIDTH = 100;
    const TITLE_CONTENT_SPACING = 20;
    
    // Calculer hauteur max des features
    let maxFeatures = 0;
    Object.values(structure).forEach(stages => {
        Object.values(stages).forEach(substages => {
            Object.values(substages).forEach(features => {
                maxFeatures = Math.max(maxFeatures, features.length);
            });
        });
    });
    const FEATURE_BLOCK_HEIGHT = Math.max(maxFeatures * 15 + 30, 150);
    
    function getProgressColor(percentage) {
        const t = config.thresholds;
        const c = config.colors;
        
        if (percentage === 0) return c[0];
        if (percentage < t[1]) return c[1];
        if (percentage < t[2]) return c[2];
        if (percentage < t[3]) return c[3];
        if (percentage < 100) return c[4];
        return c[5];
    }
    
    function escapeXml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
            .replace(/&lt;br\/&gt;/g, '<br/>');
    }
    
    let cellId = 2;
    let cells = '';
    
    const y_offset = 20;
    const stage_label_y = y_offset + STAGE_HEIGHT + PADDING;
    const feature_label_y = stage_label_y + STAGE_HEIGHT + PADDING + SUBSTAGE_HEIGHT + PADDING;
    
    // Calculer les positions Y pour chaque WP
    let wpLabelY = {};
    let currentY = feature_label_y + FEATURE_BLOCK_HEIGHT + PADDING;
    
    config.workPackages.forEach(wp => {
        wpLabelY[wp] = currentY;
        currentY += WP_HEIGHT + PADDING;
    });
    
    // Labels de titre
    cells += `<mxCell id="${cellId++}" value="Epic" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#666666;strokeColor=#666666;fontColor=#FFFFFF;fontSize=14;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${PADDING}" y="${y_offset}" width="${LABEL_WIDTH}" height="${STAGE_HEIGHT}" as="geometry"/></mxCell>`;
    cells += `<mxCell id="${cellId++}" value="Stage" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#666666;strokeColor=#666666;fontColor=#FFFFFF;fontSize=14;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${PADDING}" y="${stage_label_y}" width="${LABEL_WIDTH}" height="${STAGE_HEIGHT + PADDING + SUBSTAGE_HEIGHT}" as="geometry"/></mxCell>`;
    cells += `<mxCell id="${cellId++}" value="Feature" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#666666;strokeColor=#666666;fontColor=#FFFFFF;fontSize=14;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${PADDING}" y="${feature_label_y}" width="${LABEL_WIDTH}" height="${FEATURE_BLOCK_HEIGHT}" as="geometry"/></mxCell>`;
    
    // Labels pour chaque WP
    config.workPackages.forEach(wp => {
        cells += `<mxCell id="${cellId++}" value="${escapeXml(wp)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#666666;strokeColor=#666666;fontColor=#FFFFFF;fontSize=14;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${PADDING}" y="${wpLabelY[wp]}" width="${LABEL_WIDTH}" height="${WP_HEIGHT}" as="geometry"/></mxCell>`;
    });
    
    let epic_x = LABEL_WIDTH + TITLE_CONTENT_SPACING;
    const epics = Object.keys(structure).sort();
    
    epics.forEach((epicName, epicIdx) => {
        const stages = structure[epicName];
        const colors = colorPalettes[epicIdx % colorPalettes.length];
        const [epicColor, stageColor, substageColor] = colors;
        
        // Calculer largeur epic
        let epicWidth = 0;
        const stageWidths = [];
        Object.keys(stages).sort().forEach(stageName => {
            const substages = stages[stageName];
            const realSubstages = Object.keys(substages).filter(s => s !== '0');
            const numSubstages = realSubstages.length > 0 ? realSubstages.length : 1;
            const stageWidth = numSubstages * (SUBSTAGE_WIDTH + PADDING) - PADDING;
            stageWidths.push(stageWidth);
            epicWidth += stageWidth + PADDING;
        });
        epicWidth -= PADDING;
        
        // Epic bloc
        cells += `<mxCell id="${cellId++}" value="${escapeXml(epicName)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${epicColor};strokeColor=${epicColor};fontColor=#FFFFFF;fontSize=20;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${epic_x}" y="${y_offset}" width="${epicWidth}" height="${STAGE_HEIGHT}" as="geometry"/></mxCell>`;
        
        // Stages
        let stage_x = epic_x;
        Object.keys(stages).sort().forEach((stageName, stageIdx) => {
            const substages = stages[stageName];
            const stageWidth = stageWidths[stageIdx];
            const hasRealSubstages = Object.keys(substages).some(s => s !== '0');
            
            if (!hasRealSubstages && substages['0']) {
                // Stage sans substage
                const stageHeightDouble = STAGE_HEIGHT + PADDING + SUBSTAGE_HEIGHT;
                cells += `<mxCell id="${cellId++}" value="${escapeXml(stageName)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${stageColor};strokeColor=${stageColor};fontColor=#000000;fontSize=16;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${stage_x}" y="${stage_label_y}" width="${stageWidth}" height="${stageHeightDouble}" as="geometry"/></mxCell>`;
                
                const features = substages['0'];
                const featureText = features.map(f => `• ${escapeXml(f)}`).join('&lt;br/&gt;');
                cells += `<mxCell id="${cellId++}" value="${featureText}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${stageColor};strokeWidth=2;fontColor=#000000;fontSize=8;align=left;verticalAlign=top;spacingLeft=5;spacingTop=5;" parent="1" vertex="1"><mxGeometry x="${stage_x}" y="${feature_label_y}" width="${stageWidth}" height="${FEATURE_BLOCK_HEIGHT}" as="geometry"/></mxCell>`;
                
                // Barres de progression pour chaque WP
                const wpProgressions = progressions[epicName][stageName]['0'];
                const wpTargets = targets[epicName][stageName]['0'];
                
                config.workPackages.forEach((wp, wpIdx) => {
                    const hasThisWP = wpTargets[wp];
                    const values = wpProgressions[wp] || [];
                    
                    // WP1 conditionnel (premier WP seulement), autres toujours affichés
                    const isFirstWP = wpIdx === 0;
                    const shouldDisplay = !isFirstWP || hasThisWP;
                    
                    if (shouldDisplay && values.length > 0) {
                        const sum = values.reduce((a, b) => a + b, 0);
                        const percentage = Math.min(100, sum * 100);
                        const color = getProgressColor(percentage);
                        cells += `<mxCell id="${cellId++}" value="${percentage.toFixed(0)}%" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=${color};fontColor=#FFFFFF;fontSize=10;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${stage_x}" y="${wpLabelY[wp]}" width="${stageWidth}" height="${WP_HEIGHT}" as="geometry"/></mxCell>`;
                    }
                });
            } else {
                // Stage avec substages
                cells += `<mxCell id="${cellId++}" value="${escapeXml(stageName)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${stageColor};strokeColor=${stageColor};fontColor=#000000;fontSize=16;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${stage_x}" y="${stage_label_y}" width="${stageWidth}" height="${STAGE_HEIGHT}" as="geometry"/></mxCell>`;
                
                let substage_x = stage_x;
                Object.keys(substages).sort().forEach(substageName => {
                    if (substageName === '0') return;
                    
                    const features = substages[substageName];
                    const substage_y = stage_label_y + STAGE_HEIGHT + PADDING;
                    
                    cells += `<mxCell id="${cellId++}" value="${escapeXml(substageName)}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${substageColor};strokeColor=${substageColor};fontColor=#000000;fontSize=16;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${substage_x}" y="${substage_y}" width="${SUBSTAGE_WIDTH}" height="${SUBSTAGE_HEIGHT}" as="geometry"/></mxCell>`;
                    
                    const featureText = features.map(f => `• ${escapeXml(f)}`).join('&lt;br/&gt;');
                    cells += `<mxCell id="${cellId++}" value="${featureText}" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${substageColor};strokeWidth=2;fontColor=#000000;fontSize=8;align=left;verticalAlign=top;spacingLeft=5;spacingTop=5;" parent="1" vertex="1"><mxGeometry x="${substage_x}" y="${feature_label_y}" width="${SUBSTAGE_WIDTH}" height="${FEATURE_BLOCK_HEIGHT}" as="geometry"/></mxCell>`;
                    
                    // Barres de progression
                    const wpProgressions = progressions[epicName][stageName][substageName];
                    const wpTargets = targets[epicName][stageName][substageName];
                    
                    config.workPackages.forEach((wp, wpIdx) => {
                        const hasThisWP = wpTargets[wp];
                        const values = wpProgressions[wp] || [];
                        
                        const isFirstWP = wpIdx === 0;
                        const shouldDisplay = !isFirstWP || hasThisWP;
                        
                        if (shouldDisplay && values.length > 0) {
                            const sum = values.reduce((a, b) => a + b, 0);
                            const percentage = Math.min(100, sum * 100);
                            const color = getProgressColor(percentage);
                            cells += `<mxCell id="${cellId++}" value="${percentage.toFixed(0)}%" style="rounded=0;whiteSpace=wrap;html=1;fillColor=${color};strokeColor=${color};fontColor=#FFFFFF;fontSize=10;fontStyle=1;align=center;verticalAlign=middle;" parent="1" vertex="1"><mxGeometry x="${substage_x}" y="${wpLabelY[wp]}" width="${SUBSTAGE_WIDTH}" height="${WP_HEIGHT}" as="geometry"/></mxCell>`;
                        }
                    });
                    
                    substage_x += SUBSTAGE_WIDTH + PADDING;
                });
            }
            
            stage_x += stageWidth + PADDING;
        });
        
        epic_x = stage_x;
    });
    
    const xml = `<mxfile host="app.diagrams.net" modified="2024-01-01T00:00:00.000Z" agent="Roadmap Generator" version="22.1.0" type="device">
  <diagram name="Epic Roadmap - ${config.userJourneys.join(' + ')}" id="epic-roadmap">
    <mxGraphModel dx="1434" dy="764" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
    
    console.log('XML généré, longueur:', xml.length);
    return xml;
}

function downloadDrawio(xmlContent, filename) {
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
}

// Initialisation
updateSteps();
