/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { LanguageKind } from '../RPC/LanguageKind';
import { isRazorCSharpFile, getRazorDocumentUri } from '../RazorConventions';
import { RazorLanguageServiceClient } from '../RazorLanguageServiceClient';
import { RazorLogger } from '../RazorLogger';

export class MappingHelpers {
    public readonly language = 'Razor';

    public static async remapGeneratedFileWorkspaceEdit(
        workspaceEdit: vscode.WorkspaceEdit,
        serviceClient: RazorLanguageServiceClient,
        logger: RazorLogger,
        token: vscode.CancellationToken) {
        const map = new Map<vscode.Uri, vscode.TextEdit[]>();

        // The returned edits will be for the projected C# documents. We now need to re-map that to the original document.
        for (const entry of workspaceEdit.entries()) {
            const uri = entry[0];
            const edits = entry[1];

            if (!isRazorCSharpFile(uri)) {
                // This edit happens outside of a Razor document. Let the edit go through as is.
                map.set(uri, edits);
                continue;
            }

            // We're now working with a Razor CSharp document.
            const documentUri = getRazorDocumentUri(uri);

            // Re-map each edit to its position in the original Razor document.
            for (const edit of edits) {
                const remappedResponse = await serviceClient.mapToDocumentRanges(
                    LanguageKind.CSharp,
                    [edit.range],
                    documentUri);

                if (!remappedResponse ||
                    !remappedResponse.ranges ||
                    !remappedResponse.ranges[0]) {
                    // This is kind of wrong. Workspace edits commonly consist of a bunch of different edits which
                    // don't make sense individually. If we try to introspect on them individually there won't be
                    // enough context to do anything intelligent. But we also need to know if the edit can just
                    // be handled by mapToDocumentRange (something went wrong here), so we ignore the edit.
                    logger.logWarning(`Unable to remap file ${uri.path} at ${edit.range}.`);
                    continue;
                } else {
                    const remappedEdit = new vscode.TextEdit(remappedResponse.ranges[0], edit.newText);

                    logger.logVerbose(
                        `Re-mapping text ${edit.newText} at ${edit.range} in ${uri.path} to ${remappedResponse.ranges[0]} in ${documentUri.path}`);

                    this.addElementToDictionary(map, documentUri, remappedEdit);
                }

            }
        }

        const result = this.mapToTextEdit(map);
        return result;
    }

    public static async remapGeneratedFileLocation(
        location: vscode.Location,
        serviceClient: RazorLanguageServiceClient,
        logger: RazorLogger,
        token: vscode.CancellationToken) {

        if (!isRazorCSharpFile(location.uri)) {
            // This location exists outside of a Razor document. Leave it unchanged.
            return location;
        }

        // We're now working with a Razor CSharp document.
        const documentUri = getRazorDocumentUri(location.uri);
        const remappedResponse = await serviceClient.mapToDocumentRanges(
            LanguageKind.CSharp,
            [location.range],
            documentUri);

        if (!remappedResponse ||
            !remappedResponse.ranges ||
            !remappedResponse.ranges[0]) {
            // Something went wrong when re-mapping to the original document. Ignore this location.
            logger.logWarning(`Unable to remap file ${location.uri.path} at ${location.range}.`);
            return;
        }

        logger.logVerbose(
            `Re-mapping location ${location.range} in ${location.uri.path} to ${remappedResponse.ranges[0]} in ${documentUri.path}`);

        const newLocation = new vscode.Location(documentUri, remappedResponse.ranges[0]);
        return newLocation;
    }

    public static async remapGeneratedFileLocations(
        locations: vscode.Location[],
        serviceClient: RazorLanguageServiceClient,
        logger: RazorLogger,
        token: vscode.CancellationToken) {

        const result: vscode.Location[] = [];
        for (const location of locations) {
            const remappedLocation = await this.remapGeneratedFileLocation(location, serviceClient, logger, token);
            if (remappedLocation !== undefined) {
                result.push(remappedLocation);
            }
        }

        return result;
    }

    private static mapToTextEdit(map: Map<vscode.Uri, vscode.TextEdit[]>): vscode.WorkspaceEdit {
        const result = new vscode.WorkspaceEdit();
        map.forEach((value, key) => {
            result.set(key, value);
        });

        return result;
    }

    private static addElementToDictionary(map: Map<vscode.Uri, vscode.TextEdit[]>, uri: vscode.Uri, edit: vscode.TextEdit) {
        let mapArray: vscode.TextEdit[] | undefined;

        if (map.has(uri)) {
            mapArray = map.get(uri);
            if (mapArray) {
                mapArray.push(edit);
            }
        } else {
            const editArray = new Array<vscode.TextEdit>();
            editArray.push(edit);
            map.set(uri, editArray);
        }
    }
}
