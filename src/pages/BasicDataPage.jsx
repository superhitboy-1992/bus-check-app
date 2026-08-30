import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BASIC_DATA_TYPES } from '../lib/constants';
import {
  addBasicItem,
  buildBackupPayload,
  deleteBasicItem,
  replaceAllData,
  swapStations,
  updateBasicItem,
  useBasicData,
} from '../lib/storage';
import { todayStr } from '../lib/dates';
import { downloadBlob } from '../lib/export';
import { Icon } from '../components/icons';
import { Button, Card, ConfirmDialog, Input, Modal, toast } from '../components/ui';

function isStation(item) {
  return item && 'routeName' in item;
}

export default function BasicDataPage() {
  const location = useLocation();
  const basicData = useBasicData();
  const [tab, setTab] = useState(() => location.state?.tab || 'route');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [editing, setEditing] = useState(null); // null=新建, item=编辑
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [routeInput, setRouteInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [importPayload, setImportPayload] = useState(null);
  const fileRef = useRef(null);

  const routes = basicData.routes;
  const currentList = basicData[`${tab}s`] || [];
  const isStationTab = tab === 'station';

  const displayList = useMemo(() => {
    if (!isStationTab) return currentList;
    if (!selectedRoute) return [];
    return currentList
      .filter((s) => s.routeName === selectedRoute)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [isStationTab, currentList, selectedRoute]);

  const openCreate = () => {
    if (isStationTab && !selectedRoute) return;
    setEditing(null);
    setNameInput('');
    setRouteInput('');
    setDialogOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setNameInput(item.name || '');
    setRouteInput(isStation(item) ? item.routeName || '' : item.routeName || '');
    setDialogOpen(true);
  };

  const save = async () => {
    if (!nameInput.trim()) {
      toast('名称不能为空', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const patch = { name: nameInput.trim() };
        if (tab === 'driver' || tab === 'conductor') patch.routeName = routeInput || undefined;
        if (tab === 'station') patch.routeName = selectedRoute;
        updateBasicItem(tab, editing.id, patch);
        toast('更新成功');
      } else {
        const item = { name: nameInput.trim() };
        if (tab === 'driver' || tab === 'conductor') item.routeName = routeInput || undefined;
        if (tab === 'station') item.routeName = selectedRoute;
        if (tab === 'station') item.sortOrder = displayList.length;
        addBasicItem(tab, item);
        toast('创建成功');
      }
      setDialogOpen(false);
    } catch (e) {
      console.error('保存失败', e);
      toast('保存失败，请稍后重试', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      deleteBasicItem(tab, deleteTarget.id);
      toast('删除成功');
      setDeleteTarget(null);
    } catch (e) {
      console.error('删除失败', e);
      toast('删除失败，请稍后重试', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= displayList.length) return;
    swapStations(idx, target, selectedRoute);
    toast('排序已更新');
  };

  const itemLabel = BASIC_DATA_TYPES.find((t) => t.key === tab)?.itemLabel || '记录';
  const dialogTitle = `${editing ? '编辑' : '新增'}${itemLabel}`;

  const exportBackup = () => {
    const payload = buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `公交跳车检查助手备份-${todayStr()}.json`);
    toast('备份文件已导出');
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const ok =
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.records) &&
        parsed.basicData &&
        typeof parsed.basicData === 'object' &&
        Array.isArray(parsed.basicData.routes) &&
        Array.isArray(parsed.basicData.drivers) &&
        Array.isArray(parsed.basicData.conductors) &&
        Array.isArray(parsed.basicData.stations);
      if (!ok) {
        toast('备份文件格式不正确', 'error');
        return;
      }
      setImportPayload(parsed);
    } catch (err) {
      console.error('解析备份失败', err);
      toast('备份文件解析失败', 'error');
    }
  };

  const confirmImport = () => {
    if (!importPayload) return;
    replaceAllData({ records: importPayload.records, basicData: importPayload.basicData });
    toast('导入成功');
    setImportPayload(null);
  };

  const TABS = [...BASIC_DATA_TYPES, { key: 'backup', label: '备份/恢复', itemLabel: '备份' }];

  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-30 -mx-4 -mt-4 border-b border-border bg-background px-4 py-3">
        <div className="flex gap-1 overflow-x-auto rounded-full bg-accent p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setDeleteTarget(null);
              }}
              className={`min-w-fit flex-1 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'backup' ? (
        <Card>
          <div className="space-y-5 p-5">
            <div>
              <h2 className="text-base font-semibold">数据备份</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                数据仅保存在当前浏览器的 localStorage 中，清理浏览器缓存或更换设备会丢失。建议定期导出备份文件。
              </p>
              <Button className="mt-4" onClick={exportBackup}>
                <Icon name="download" className="size-4" />
                导出 JSON 备份
              </Button>
            </div>
            <div className="border-t border-border pt-5">
              <h2 className="text-base font-semibold">数据恢复</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                导入备份文件会<strong>覆盖当前全部数据</strong>，操作前请确认。
              </p>
              <Button variant="outline" className="mt-4" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" className="size-4" />
                选择备份文件导入
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>
        </Card>
      ) : (
        <>
          {isStationTab && (
            <div className="flex items-center gap-2">
              <span className="text-sm whitespace-nowrap text-muted-foreground">线路：</span>
              <select
                value={selectedRoute}
                onChange={(e) => setSelectedRoute(e.target.value)}
                className="h-10 flex-1 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus-visible:border-primary"
              >
                <option value="">请选择线路</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Card>
            <div className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-medium">{BASIC_DATA_TYPES.find((t) => t.key === tab)?.label}</h2>
                <Button onClick={openCreate} disabled={isStationTab && !selectedRoute}>
                  <Icon name="plus" className="size-4" />
                  {isStationTab ? '新增站点' : `新增${itemLabel}`}
                </Button>
              </div>

              {isStationTab && !selectedRoute ? (
                <div className="py-12 text-center text-sm text-muted-foreground">请先选择线路以管理站点</div>
              ) : displayList.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <div className="divide-y divide-border">
                  {displayList.map((item, idx) => (
                    <div key={item.id} className="flex h-14 items-center justify-between px-1 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-medium">{item.name}</div>
                        {isStation(item) && item.routeName && (
                          <div className="truncate text-sm text-muted-foreground">{item.routeName}</div>
                        )}
                      </div>
                      <div className="ml-2 flex shrink-0 gap-1">
                        {isStationTab && (
                          <>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label="上移"
                              disabled={idx === 0}
                              onClick={() => move(idx, -1)}
                            >
                              <Icon name="chevronUp" className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label="下移"
                              disabled={idx === displayList.length - 1}
                              onClick={() => move(idx, 1)}
                            >
                              <Icon name="chevronDown" className="size-4" />
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="iconSm" aria-label="编辑" onClick={() => openEdit(item)}>
                          <Icon name="pencil" className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="iconSm"
                          aria-label="删除"
                          className="text-destructive"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Icon name="trash" className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={dialogTitle}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? '保存中...' : '确定'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{tab === 'route' ? '线路名称' : tab === 'driver' || tab === 'conductor' ? '姓名' : '站点名称'}</label>
            <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="请输入名称" />
          </div>
          {(tab === 'driver' || tab === 'conductor') && (
            <div className="space-y-2">
              <label className="text-sm font-medium">所属线路</label>
              <select
                value={routeInput}
                onChange={(e) => setRouteInput(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-transparent px-3 text-base outline-none focus-visible:border-primary md:text-sm"
              >
                <option value="">请选择线路</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="确认删除"
        description={deleteTarget ? `确定要删除「${deleteTarget.name}」${itemLabel}吗？此操作不可撤销。` : ''}
        busy={deleteBusy}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={!!importPayload}
        onClose={() => setImportPayload(null)}
        title="确认导入"
        confirmText="导入"
        description="导入备份将覆盖当前全部数据，此操作不可撤销。是否继续？"
        onConfirm={confirmImport}
      />
    </div>
  );
}
