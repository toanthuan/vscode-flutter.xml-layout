import { RootWidgetModel, WidgetModel, VariableModel, FormControlModel } from "../models/models";
import { WidgetCodeGenerator } from "./widget-generator";
import { getUniqueBy } from "../until";


export class ClassCodeGenerator {
    private readonly widgetGenerator: WidgetCodeGenerator;

    constructor(widgetGenerator: WidgetCodeGenerator) {
        this.widgetGenerator = widgetGenerator;
    }

    generate(rootWidget: RootWidgetModel, controllerPath: string): string {
        let vars: VariableModel[] = this.getChildrenRecursively<VariableModel>(rootWidget.rootChild, w => w.vars);
        vars = getUniqueBy(vars, a => a.name);

        let controllers: VariableModel[] = this.getChildrenRecursively<VariableModel>(rootWidget.rootChild, w => w.controllers);
        controllers = getUniqueBy(controllers, a => a.name);

        let formControls: FormControlModel[] = this.getChildrenRecursively<FormControlModel>(rootWidget.rootChild, w => w.formControls);
        formControls = getUniqueBy(formControls, a => a.name);

        const mixins: string[] = [...new Set([...rootWidget.mixins, ...this.getChildrenRecursively<string>(rootWidget.rootChild, w => w.mixins as any)])];
        const rootChildCode = this.widgetGenerator.generateWidgetCode(rootWidget.rootChild, 0);
        const widgetName = rootWidget.type;
        const hasController = !!rootWidget.controller;
        // todo
        const isStateful = true;
        // const isStateful = rootWidget.stateful;

        // route aware
        let routeAwareStateMethods = '';
        let routeAwareControllerMethods = '';
        const routeAware = rootWidget.routeAware;
        if (routeAware && hasController) {
          routeAwareStateMethods = `
  // Called when the top route has been popped off, and the current route shows up.
  void didPopNext() {
    ctrl.didPopNext();
  }

  // Called when the current route has been pushed.
  void didPush() {
    ctrl.didPush();
  }

  // Called when the current route has been popped off.
  void didPop() {
    ctrl.didPop();
  }

  // Called when a new route has been pushed, and the current route is no longer visible.
  void didPushNext() {
    ctrl.didPushNext();
  }`;

          routeAwareControllerMethods = `
  void didPopNext() {
  }

  void didPush() {
  }

  void didPop() {
  }

  void didPushNext() {
  }`;
        }


        //
        // mixins
        //         
        let mixinsCode = '';
        if (mixins && mixins.length) {
          mixinsCode = ' with ' + mixins.map(a => a).join(', ');
        }

        //
        // build method
        //
        let buildMethodContent = 
`
  @override
  Widget build(BuildContext context) {
    final _pipeProvider = Provider.of<PipeProvider>(context);
    final widget = ${rootChildCode};
    return widget;
  }`;


        if (hasController) {
          rootWidget.imports.push({ path: `${rootWidget.controllerPath || controllerPath}` });
        }
        rootWidget.imports.push({ path: `package:flutter/material.dart` });
        rootWidget.imports.push({ path: `package:flutter_xmllayout_helpers/flutter_xmllayout_helpers.dart` });
        rootWidget.imports.push({ path: `package:provider/provider.dart` });


        let code = `${rootWidget.imports.map(a => `import '${a.path}';`).join('\n')}`;

        // 
        // widget state
        //
        if (isStateful) {
            code += this.createStatefulWidget(widgetName, mixinsCode, rootWidget, controllers, routeAware, routeAwareStateMethods, buildMethodContent, hasController, formControls);
        }
        else {
          code += this.createStatelessWidget(rootWidget, widgetName, mixinsCode, buildMethodContent);
        }

        // 
        // base controller
        //
        if (hasController) {
          code += this.createControllerBase(rootWidget, controllers, vars, formControls, routeAwareControllerMethods);
        }

        return code;
    }
    
    private createControllerBase(rootWidget: RootWidgetModel, controllers: VariableModel[], vars: VariableModel[], formControls: FormControlModel[], routeAwareControllerMethods: string) {
        const varsLines: string[] = [
            ...controllers.filter(a => !a.isPrivate && !a.skipGenerate).map(a => this.createControllerVar(a)),
            ...vars.map(a => a.type ? `final ${a.name} = new ${a.type}();` : a.name),
            ...rootWidget.vars.map(a => this.createControllerVar(a)),
            ...rootWidget.params.map(a => this.createControllerVar(a)),
            ...rootWidget.providers.map(a => this.createControllerVar(a))
        ];
        const disposeLines = [
          ...controllers.filter(a => !a.isPrivate).map(a => a.name),
          ...vars.filter(a => a.type === 'FormGroup').map(a => a.name)
        ];

        return `

class ${rootWidget.controller}Base {
  bool _loaded = false;
  bool _controllerAttached = false;
  ${varsLines.join('\n  ')}

  void _attachFormControllers(${formControls.map(a => `${a.controller}`).join(',\n      ')}) {
    if (_controllerAttached) {
      return;
    }
    _controllerAttached = true;
    ${formControls.map(a => `${a.name}.attachTextEditingController(${a.controller});`).join('\n    ')}
  }

  void _load(BuildContext context) {
    if (!_loaded) {
      _loaded = true;
      didLoad(context);
    }
    
    onBuild(context);
  }

  void didLoad(BuildContext context) {
  }

  void onBuild(BuildContext context) {
  }

  void afterFirstBuild(BuildContext context) {
  }
  ${routeAwareControllerMethods}

  @mustCallSuper
  void dispose() {
    ${disposeLines.map(a => `${a}.dispose();`).join('\n    ')}
  }
}`;
    }

    private createStatelessWidget(rootWidget: RootWidgetModel, widgetName: string, mixinsCode: string, buildMethodContent: string) {
      // todo add variables, formGroups, services, controllers, routeAware events...
      return `

class ${widgetName} extends StatelessWidget${mixinsCode} {
  ${rootWidget.params.map(a => `final ${a.type ? a.type + ' ' : ''}${a.name}${a.value !== undefined ? ' = ' + a.value : ''};`).join('\n  ')}
  ${widgetName}(${rootWidget.params.length ? '{': ''}
    ${rootWidget.params.map(a => `${a.required ? '@required ' : ''}this.${a.name}`).join(',\n    ')}
  ${rootWidget.params.length ? '}': ''});
  ${buildMethodContent}
}
      `;
    }

    private createStatefulWidget(widgetName: string, mixinsCode: string, rootWidget: RootWidgetModel, controllers: VariableModel[], routeAware: boolean, routeAwareStateMethods: string, buildMethodContent: string, hasController: boolean, formControls: FormControlModel[]) {
        const stateVarsDeclaration: string[] = [
            ...(hasController ? [`${rootWidget.controller} ctrl;`] : []),
            ...controllers.filter(a => !a.skipGenerate).map(a => a.isPrivate ? `final ${a.name} = new ${a.type}();` : `${a.type} ${a.name};`),
            ...rootWidget.providers.map(a => `${a.type} ${a.name};`),
            ...rootWidget.vars.map(a => `${a.type} ${a.name};`),
            ...(routeAware ? [`RouteObserver<Route> _routeObserver;`] : [])
        ];
        const attachFormControllersCode = `ctrl._attachFormControllers(${formControls.map(a => `${a.controller}`).join(',\n      ')});`;
        const stateVarsInit: string[] = [
            ...(hasController ? [`ctrl = new ${rootWidget.controller}();`] : []),
            ...rootWidget.params.map(a => `ctrl._${a.name} = widget.${a.name};`),
            ...controllers.filter(a => !a.isPrivate && !a.skipGenerate).map(a => `${hasController ? `ctrl._${a.name} = `: ''}${a.name} = ${a.value ? a.value : `new ${a.type}()`};`),
            ...rootWidget.vars.map(a => `${hasController ? `ctrl._${a.name} = `: ''}${a.name} = ${a.value};`),
            ...(hasController ? [`WidgetsBinding.instance.addPostFrameCallback((_) => ctrl.afterFirstBuild(context));`] : [])
        ];

        return `

class ${widgetName} extends StatefulWidget {
  ${rootWidget.params.map(a => `final ${a.type ? a.type + ' ' : ''}${a.name}${a.value !== undefined ? ' = ' + a.value : ''};`).join('\n  ')}
  ${widgetName}(${rootWidget.params.length ? '{': ''}
    ${rootWidget.params.map(a => `${a.required ? '@required ' : ''}this.${a.name}`).join(',\n    ')}
  ${rootWidget.params.length ? '}': ''});

  @override
  _${widgetName}State createState() => _${widgetName}State();
}

class _${widgetName}State extends State<${widgetName}>${mixinsCode} {
  ${stateVarsDeclaration.join('\n  ')}
  ${routeAwareStateMethods}

  @override
  void initState() {
    super.initState();
    ${stateVarsInit.join(`\n    `)}
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();${routeAware ? `\n    _routeObserver = Provider.of<RouteObserver<Route>>(context)..subscribe(this, ModalRoute.of(context));` : ''}
    ${rootWidget.providers.map(a => `${hasController ? `ctrl._${a.name} = `: ''}${a.name} = Provider.of<${a.type}>(context);`).join('\n  ')}
    ${hasController ? `ctrl._load(context);\n    ${attachFormControllersCode}` : ''}
  }

  @override
  void dispose() {
    ${hasController ? `ctrl.dispose();` : ''}${routeAware ? `\n    _routeObserver.unsubscribe(this);` : ''}
    ${controllers.filter(a => a.isPrivate).map(a => `${a.name}.dispose();`).join('\n    ')}
    super.dispose();
  }
  ${buildMethodContent}
}`;
    }

    private createControllerVar(a: VariableModel): string {
        a.type = a.type || 'var';
        return `${a.type} _${a.name};\n  ${a.type} get ${a.name} => _${a.name};`;
    }

    generateControllerFile(fileName: string, rootWidget: RootWidgetModel): string {
        if (!rootWidget.controller) {
          return '';
        }

        let code = `import 'package:flutter/widgets.dart';
import '${fileName}.xml.dart';

class ${rootWidget.controller} extends ${rootWidget.controller}Base {

  @override
  void didLoad(BuildContext context) {
  }

  @override
  void onBuild(BuildContext context) {
  }

  @override
  void afterFirstBuild(BuildContext context) {
  }

  @override
  void dispose() {
    super.dispose();
  }
}`;
        return code;
    }

    private getChildrenRecursively<T>(widget: WidgetModel | null, variableGetter: (widget: WidgetModel) => T[]): T[] {
        if (!widget) {
            return [];
        }

        const res = variableGetter(widget as any) || [];

        if (widget instanceof Array) {
            widget = widget[0] as any;
            if (!widget) {
                return [];
            }
        }

        widget.properties.forEach(prop => {
            let property = prop;
            if (prop.dataType === 'propertyElement') {
              // unwrap the contained property
              property = prop.value as any;
            }

            if (property.dataType === 'widget') {
                res.push(...this.getChildrenRecursively(property.value as WidgetModel, variableGetter));
            }
            else if (property.dataType === 'widgetList') {
                (property.value as WidgetModel[]).forEach(w => {
                    res.push(...this.getChildrenRecursively(w, variableGetter));
                });
            }
        });
        
        if (widget.wrappedWidgets) {
            widget.wrappedWidgets.forEach(w => res.push(...this.getChildrenRecursively(w, variableGetter)));
        }

        return new Array(...new Set(res));
    }
}