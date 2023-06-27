import { makeT } from "app/client/lib/localization";
import { createSessionObs } from "app/client/lib/sessionObs";
import { DocPageModel } from "app/client/models/DocPageModel";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { getTimeFromNow } from "app/client/models/HomeModel";
import { buildConfigContainer } from "app/client/ui/RightPanel";
import { buttonSelect } from "app/client/ui2018/buttonSelect";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuAnnotate, menuItemLink } from "app/client/ui2018/menus";
import { buildUrlId, parseUrlId } from "app/common/gristUrls";
import { StringUnion } from "app/common/StringUnion";
import { DocSnapshot } from "app/common/UserAPI";
import {
  Disposable,
  dom,
  IDomComponent,
  MultiHolder,
  Observable,
  styled,
} from "grainjs";
import moment from "moment";
import { invokePrompt } from "app/client/ui2018/modals";
import { cssInput } from "./cssInput";

const t = makeT("DocHistory");

const DocHistorySubTab = StringUnion("activity", "snapshots");

export class DocHistory extends Disposable implements IDomComponent {
  private _subTab = createSessionObs(
    this,
    "docHistorySubTab",
    "snapshots",
    DocHistorySubTab.guard
  );

  constructor(
    private _docPageModel: DocPageModel,
    private _actionLog: IDomComponent
  ) {
    super();
  }

  public debounce<T extends (...args: any[]) => void>(
    func: T,
    delay: number
  ): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }
  public buildDom() {
    const tabs = [
      { value: "activity", label: t("Activity") },
      { value: "snapshots", label: t("Snapshots") },
    ];
    return [
      cssSubTabs(
        buttonSelect(this._subTab, tabs, {}, testId("doc-history-tabs"))
      ),
      dom.domComputed(this._subTab, (subTab) =>
        buildConfigContainer(
          subTab === "activity"
            ? this._actionLog.buildDom()
            : subTab === "snapshots"
            ? dom.create(this._buildSnapshots.bind(this))
            : null
        )
      ),
    ];
  }

  private _buildSnapshots(owner: MultiHolder) {
    // Fetch snapshots, and render.
    const doc = this._docPageModel.currentDoc.get();
    if (!doc) {
      return null;
    }

    // origUrlId is the snapshot-less URL, which we use to fetch snapshot history, and for
    // snapshot comparisons.
    const origUrlId = buildUrlId({ ...doc.idParts, snapshotId: undefined });

    // If comparing one snapshot to another, get the other ID, so that we can highlight it too.
    const compareUrlId = urlState().state.get().params?.compare;
    const compareSnapshotId =
      compareUrlId && parseUrlId(compareUrlId).snapshotId;

    // Helper to set a link to open a snapshot, optionally comparing it with a docId.
    // We include urlState().state to preserve the currently selected page.
    function setLink(snapshot: DocSnapshot, compareDocId?: string) {
      return dom.attr("href", (use) =>
        urlState().makeUrl({
          ...use(urlState().state),
          doc: snapshot.docId,
          params: compareDocId ? { compare: compareDocId } : {},
        })
      );
    }

    const snapshots = Observable.create<DocSnapshot[]>(owner, []);
    const snapshotsDenied = Observable.create<boolean>(owner, false);
    const userApi = this._docPageModel.appModel.api;

    const docApi = userApi.getDocAPI(origUrlId);
    docApi
      .getSnapshots()
      .then(
        (result) => snapshots.isDisposed() || snapshots.set(result.snapshots)
      )
      .catch((err) => {
        snapshotsDenied.set(true);
        reportError(err);
      });

    // Rename DocSnapshot with snapshotName
    async function _promptForName() {
      return await invokePrompt("Snapshot Name", "Rename", "", "Default name");
    }
    async function renameDocSnapshot() {
      const snapshotName = await _promptForName();
      //console.log("Snapshot name", snapshotName);
      return snapshotName;
    }

    return dom(
      "div",
      dom.maybe(snapshotsDenied, () =>
        cssSnapshotDenied(
          t("Snapshots are unavailable."),
          testId("doc-history-error")
        )
      ),
      // Note that most recent snapshots are first.
      dom.domComputed(snapshots, (snapshotList) =>
        snapshotList.map((snapshot, index) => {
          let inputEl: HTMLInputElement;
          console.log("inputEl", inputEl!);

          const snapName = observable(snapshot.label || "");

          const modified = moment(snapshot.lastModified);
          snapshot.label = "Snapshoot!";

          const prevSnapshot = snapshotList[index + 1] || null;
          return cssSnapshot(
            cssSnapshotTime(getTimeFromNow(snapshot.lastModified)),
            cssSnapshotCard(
              cssSnapshotCard.cls(
                "-current",
                Boolean(
                  snapshot.snapshotId === doc.idParts.snapshotId ||
                    (compareSnapshotId &&
                      snapshot.snapshotId === compareSnapshotId)
                )
              ),
              dom("div", [
                cssInput([
                  cssDatePart(modified.format("ddd ll LT")),
                  dom.on(
                    "input",
                    this.debounce((e, elem) => {
                      const name = elem.value;
                      snapName.set(name);
                      snapshot.label = name || "SnapShot";
                      const snapValue = snapName.get();

                      console.log(snapValue, "value");
                    }, 500)
                  ),
                ]),
              ]),

              cssMenuDots(
                icon("Dots"),
                menu(
                  () => [
                    menuItemLink(setLink(snapshot), t("Open Snapshot")),

                    menuItemLink(
                      dom.on("click", async () => {
                        snapshot.label = await renameDocSnapshot();
                      }),

                      t("Rename Snapshot"),
                      menuAnnotate(t("Dev"))
                    ),

                    menuItemLink(
                      setLink(snapshot, origUrlId),
                      t("Compare to Current"),
                      menuAnnotate(t("Beta"))
                    ),
                    prevSnapshot &&
                      menuItemLink(
                        setLink(prevSnapshot, snapshot.docId),
                        t("Compare to Previous"),
                        menuAnnotate(t("Beta"))
                      ),
                  ],
                  {
                    placement: "bottom-end",
                    parentSelectorToMark: "." + cssSnapshotCard.className,
                  }
                ),
                testId("doc-history-snapshot-menu")
              ),

              testId("doc-history-card")
            ),
            testId("doc-history-snapshot")
          );
        })
      )
    );
  }
}

const cssSubTabs = styled(
  "div",
  `
  padding: 16px;
  border-bottom: 1px solid ${theme.pagePanelsBorder};
`
);

const cssSnapshot = styled(
  "div",
  `
  margin: 8px 16px;
`
);

const cssSnapshotDenied = styled(
  "div",
  `
  margin: 8px 16px;
`
);

const cssSnapshotTime = styled(
  "div",
  `
  text-align: right;
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
`
);

const cssSnapshotCard = styled(
  "div",
  `
  border: 1px solid ${theme.documentHistorySnapshotBorder};
  padding: 8px;
  color: ${theme.documentHistorySnapshotFg};
  background: ${theme.documentHistorySnapshotBg};
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  --icon-color: ${theme.controlSecondaryFg};

  &-current {
    background-color: ${theme.documentHistorySnapshotSelectedBg};
    color: ${theme.documentHistorySnapshotSelectedFg};
    --icon-color: ${theme.documentHistorySnapshotSelectedFg};
  }
`
);

// const cssDatePart = styled(
//   "span",
//   `
//   display: inline-block;
// `
// );

const cssMenuDots = styled(
  "div",
  `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: default;
  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`
);
